use std::ffi::OsString;
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::{CancellationToken, ValeError, ValeErrorKind};

const POLL_INTERVAL: Duration = Duration::from_millis(2);
const MAX_EXECUTABLE_BUSY_RETRIES: usize = 25;

/// Minimal trusted search path for helpers invoked by the isolated Vale child.
///
/// Vale itself is selected by explicit path; this constant avoids inheriting
/// caller-controlled executable lookup while retaining standard POSIX helpers.
#[cfg(unix)]
const ISOLATED_PATH: &str = "/usr/bin:/bin";

#[cfg(test)]
type AfterSpawnHook = Box<dyn FnOnce(&mut std::process::Child)>;

#[cfg(test)]
thread_local! {
    static AFTER_SPAWN_BEFORE_DEADLINE: std::cell::RefCell<Option<AfterSpawnHook>> =
        const { std::cell::RefCell::new(None) };
    static BEFORE_COMPLETION_ACCEPTANCE: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn set_after_spawn_before_deadline(hook: impl FnOnce(&mut std::process::Child) + 'static) {
    AFTER_SPAWN_BEFORE_DEADLINE.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn run_after_spawn_before_deadline(child: &mut std::process::Child) {
    AFTER_SPAWN_BEFORE_DEADLINE.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(child);
        }
    });
}

#[cfg(test)]
fn set_before_completion_acceptance(hook: impl FnOnce() + 'static) {
    BEFORE_COMPLETION_ACCEPTANCE.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn run_before_completion_acceptance() {
    BEFORE_COMPLETION_ACCEPTANCE.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook();
        }
    });
}

pub(crate) enum ProcessInput {
    None,
    Bytes(Vec<u8>),
}

pub(crate) struct ProcessOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

fn spawn_with_executable_busy_retry<T>(mut spawn: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut retries = 0;
    loop {
        match spawn() {
            Err(error) if executable_is_busy(&error) && retries < MAX_EXECUTABLE_BUSY_RETRIES => {
                retries += 1;
                thread::sleep(POLL_INTERVAL);
            }
            result => return result,
        }
    }
}

fn executable_is_busy(error: &io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(rustix::io::Errno::TXTBSY.raw_os_error())
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

impl ProcessOutput {
    pub(crate) fn stdout_text(&self) -> Result<&str, ValeError> {
        std::str::from_utf8(&self.stdout).map_err(|error| {
            ValeError::new(
                ValeErrorKind::InvalidUtf8,
                format!("Vale stdout is not UTF-8: {error}"),
            )
        })
    }
}

struct CapturedStream {
    bytes: Vec<u8>,
    exceeded: bool,
}

pub(crate) fn run_process(
    executable: &Path,
    arguments: &[OsString],
    working_directory: &Path,
    input: ProcessInput,
    timeout: Duration,
    output_limit: usize,
    cancellation: &CancellationToken,
) -> Result<ProcessOutput, ValeError> {
    if cancellation.is_cancelled() {
        return Err(ValeError::new(
            ValeErrorKind::Cancelled,
            "Vale process was cancelled before start",
        ));
    }

    let mut command = Command::new(executable);
    isolate_environment(&mut command);
    command
        .args(arguments)
        .current_dir(working_directory)
        .stdin(if matches!(&input, ProcessInput::Bytes(_)) {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    let mut child = spawn_with_executable_busy_retry(|| command.spawn()).map_err(|error| {
        let kind = match error.kind() {
            io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied => ValeErrorKind::Unavailable,
            _ => ValeErrorKind::ProcessFailure,
        };
        ValeError::new(
            kind,
            format!(
                "could not start Vale executable {}: {error}",
                executable.display()
            ),
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .expect("piped Vale stdout must be available");
    let stderr = child
        .stderr
        .take()
        .expect("piped Vale stderr must be available");
    let stdout_reader = thread::spawn(move || read_capped(stdout, output_limit));
    let stderr_reader = thread::spawn(move || read_capped(stderr, output_limit));
    let stdin_writer = match input {
        ProcessInput::None => None,
        ProcessInput::Bytes(bytes) => {
            let mut stdin = child
                .stdin
                .take()
                .expect("piped Vale stdin must be available");
            Some(thread::spawn(move || stdin.write_all(&bytes)))
        }
    };

    #[cfg(test)]
    run_after_spawn_before_deadline(&mut child);
    let started = Instant::now();
    let mut status = None;
    let process_result = loop {
        if cancellation.is_cancelled() {
            terminate(&mut child);
            break Err(ValeError::new(
                ValeErrorKind::Cancelled,
                "Vale process was cancelled",
            ));
        }
        if status.is_none() {
            match child.try_wait() {
                Ok(Some(completed)) => status = Some(completed),
                Ok(None) => {}
                Err(error) => {
                    terminate(&mut child);
                    break Err(ValeError::new(
                        ValeErrorKind::ProcessFailure,
                        format!("could not poll Vale process: {error}"),
                    ));
                }
            }
        }
        let input_finished = stdin_writer
            .as_ref()
            .is_none_or(thread::JoinHandle::is_finished);
        if started.elapsed() >= timeout {
            terminate(&mut child);
            break Err(ValeError::new(
                ValeErrorKind::Timeout,
                format!("Vale process exceeded {} ms", timeout.as_millis()),
            ));
        }
        let completed = status.filter(|_| {
            input_finished && stdout_reader.is_finished() && stderr_reader.is_finished()
        });
        #[cfg(test)]
        if completed.is_some() {
            run_before_completion_acceptance();
        }
        if completed.is_some() && cancellation.is_cancelled() {
            terminate(&mut child);
            break Err(ValeError::new(
                ValeErrorKind::Cancelled,
                "Vale process was cancelled",
            ));
        }
        if let Some(status) = completed {
            break Ok(status);
        }
        thread::sleep(POLL_INTERVAL);
    };

    let input_result = stdin_writer.map(join_writer).transpose();
    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    let status = process_result?;
    if status.success() {
        if let Some(write_result) = input_result? {
            write_result.map_err(|error| {
                ValeError::new(
                    ValeErrorKind::ProcessFailure,
                    format!("could not write Vale stdin: {error}"),
                )
            })?;
        }
    }
    if stdout.exceeded || stderr.exceeded {
        return Err(ValeError::new(
            ValeErrorKind::OutputTooLarge,
            format!("Vale output exceeded the configured {output_limit}-byte stream limit"),
        ));
    }

    Ok(ProcessOutput {
        status,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
    })
}

fn isolate_environment(command: &mut Command) {
    command.env_clear();
    #[cfg(unix)]
    command.env("PATH", ISOLATED_PATH);
    #[cfg(windows)]
    for name in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}

#[cfg(unix)]
fn terminate(child: &mut std::process::Child) {
    let process_group = rustix::process::Pid::from_child(child);
    let _ = rustix::process::kill_process_group(process_group, rustix::process::Signal::KILL);
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn terminate(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn join_writer(handle: thread::JoinHandle<io::Result<()>>) -> Result<io::Result<()>, ValeError> {
    handle.join().map_err(|_| {
        ValeError::new(
            ValeErrorKind::ProcessFailure,
            "Vale stdin writer thread panicked",
        )
    })
}

fn join_reader(
    handle: thread::JoinHandle<io::Result<CapturedStream>>,
) -> Result<CapturedStream, ValeError> {
    handle
        .join()
        .map_err(|_| {
            ValeError::new(
                ValeErrorKind::ProcessFailure,
                "Vale output reader thread panicked",
            )
        })?
        .map_err(|error| {
            ValeError::new(
                ValeErrorKind::ProcessFailure,
                format!("could not read Vale output: {error}"),
            )
        })
}

fn read_capped(mut reader: impl Read, limit: usize) -> io::Result<CapturedStream> {
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut exceeded = false;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&buffer[..retained]);
        if retained < read {
            exceeded = true;
        }
    }
    Ok(CapturedStream { bytes, exceeded })
}

#[cfg(all(test, unix))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::ffi::OsString;
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::process::{Command, ExitStatus, Stdio};
    use std::rc::Rc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use super::{
        join_reader, join_writer, run_process, set_after_spawn_before_deadline,
        set_before_completion_acceptance, spawn_with_executable_busy_retry, CapturedStream,
        ProcessInput,
    };
    use crate::{CancellationToken, ValeErrorKind};

    static PROCESS_TREE_FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

    struct ProcessTreeFixture {
        root: PathBuf,
        worker_pid: PathBuf,
    }

    impl ProcessTreeFixture {
        fn new() -> Self {
            let root = loop {
                let id = PROCESS_TREE_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
                let candidate = std::env::temp_dir().join(format!(
                    "colorful-vale-process-tree-{}-{id}",
                    std::process::id()
                ));
                match fs::create_dir(&candidate) {
                    Ok(()) => break candidate,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        panic!(
                            "create process-tree fixture {}: {error}",
                            candidate.display()
                        )
                    }
                }
            };
            let worker_pid = root.join("worker.pid");
            Self { root, worker_pid }
        }
    }

    impl Drop for ProcessTreeFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn cancellation_wins_at_the_completion_boundary() {
        let cancellation = CancellationToken::new();
        let late_cancellation = cancellation.clone();
        set_before_completion_acceptance(move || late_cancellation.cancel());

        let result = run_process(
            Path::new("/bin/sh"),
            &[OsString::from("-c"), OsString::from("printf complete")],
            Path::new("/"),
            ProcessInput::None,
            Duration::from_secs(2),
            1024,
            &cancellation,
        );
        let error = match result {
            Ok(_) => panic!("late cancellation must precede completed output"),
            Err(error) => error,
        };

        assert_eq!(error.kind(), ValeErrorKind::Cancelled);
    }

    #[test]
    fn pre_cancelled_process_does_not_spawn() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let args: [OsString; 0] = [];

        let error = run_process(
            Path::new("/colorful-test/nonexistent-vale"),
            &args,
            Path::new("/"),
            ProcessInput::None,
            Duration::from_secs(2),
            1024,
            &cancellation,
        )
        .err()
        .expect("pre-cancelled process must not reach spawn");

        assert_eq!(error.kind(), ValeErrorKind::Cancelled);
    }

    #[test]
    fn ready_worker_timeout_terminates_the_process_group() {
        assert_ready_process_tree_is_terminated(
            r#"(
  trap '' HUP TERM
  while :; do :; done
) >/dev/null 2>&1 &
printf '%s\n' "$!" > worker.pid.tmp
mv worker.pid.tmp worker.pid
wait"#,
            false,
        );
    }

    #[test]
    fn ready_descendant_timeout_remains_active_after_wrapper_exit() {
        assert_ready_process_tree_is_terminated(
            r#"(
  trap '' HUP TERM
  /bin/sleep 1
) &
printf '%s\n' "$!" > worker.pid.tmp
mv worker.pid.tmp worker.pid
while [ ! -e allow-wrapper-exit ]; do
  /bin/sleep 0.01
done
exit 0"#,
            true,
        );
    }

    #[test]
    fn readiness_rejects_a_wrapper_that_already_exited() {
        let fixture = ProcessTreeFixture::new();
        fs::write(&fixture.worker_pid, b"1").expect("record synthetic worker PID");
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .expect("spawn exited wrapper");
        child.wait().expect("reap exited wrapper");

        let error = wait_for_ready_process_tree(&fixture.worker_pid, &mut child, false)
            .expect_err("an exited wrapper cannot establish timeout ordering");

        assert_eq!(
            error,
            "ready wrapper exited before its synthetic timeout was established"
        );
    }

    #[test]
    fn readiness_propagates_malformed_worker_pid() {
        let fixture = ProcessTreeFixture::new();
        fs::write(&fixture.worker_pid, b"not-a-pid").expect("record malformed worker PID");
        let mut child = Command::new("/bin/sleep")
            .arg("1")
            .spawn()
            .expect("spawn ready wrapper");

        let error = wait_for_ready_process_tree(&fixture.worker_pid, &mut child, false)
            .expect_err("malformed worker PID must prevent timeout ordering");
        let _ = child.kill();
        child.wait().expect("reap ready wrapper");

        assert_eq!(
            error,
            "process-tree fixture recorded a non-numeric worker PID"
        );
    }

    #[test]
    fn readiness_propagates_wrapper_release_failure() {
        let fixture = ProcessTreeFixture::new();
        fs::write(&fixture.worker_pid, b"1").expect("record synthetic worker PID");
        fs::create_dir(fixture.root.join("allow-wrapper-exit"))
            .expect("occupy wrapper release path with a directory");
        let mut child = Command::new("/bin/sleep")
            .arg("1")
            .spawn()
            .expect("spawn ready wrapper");

        let error = wait_for_ready_process_tree(&fixture.worker_pid, &mut child, true)
            .expect_err("occupied release path must reject the wrapper release");
        let _ = child.kill();
        child.wait().expect("reap ready wrapper");

        assert!(
            error.starts_with("release ready wrapper: "),
            "unexpected release failure: {error}"
        );
    }

    #[test]
    fn wrapper_exit_wait_has_a_bounded_failure() {
        let mut child = Command::new("/bin/sleep")
            .arg("1")
            .spawn()
            .expect("spawn non-exiting wrapper");

        let error = wait_for_wrapper_exit_until(&mut child, Instant::now())
            .expect_err("live wrapper must exceed an elapsed deadline");
        let _ = child.kill();
        child.wait().expect("reap bounded wrapper");

        assert_eq!(error, "ready wrapper did not exit before its deadline");
    }

    #[test]
    fn worker_pid_wait_failures_are_bounded_and_categorized() {
        let fixture = ProcessTreeFixture::new();
        let missing = wait_for_worker_pid_until(&fixture.worker_pid, Instant::now())
            .expect_err("missing PID must exceed an elapsed deadline");
        assert_eq!(missing, "process-tree worker did not become ready");

        fs::write(&fixture.worker_pid, b"not-a-pid").expect("write malformed PID");
        let malformed = wait_for_worker_pid_until(&fixture.worker_pid, Instant::now())
            .expect_err("malformed PID must fail closed");
        assert_eq!(
            malformed,
            "process-tree fixture recorded a non-numeric worker PID"
        );

        let directory = fixture.root.join("pid-directory");
        fs::create_dir(&directory).expect("create unreadable PID artifact");
        let unreadable = wait_for_worker_pid_until(&directory, Instant::now())
            .expect_err("directory PID artifact must fail closed");
        assert!(
            unreadable.starts_with("read process-tree worker PID: "),
            "{unreadable}"
        );
    }

    #[test]
    fn polling_observes_pending_ready_and_deadline() {
        let probes = Cell::new(0_u8);
        let ready = poll_until(Instant::now() + Duration::from_secs(1), || {
            let current = probes.get();
            probes.set(current + 1);
            Ok(if current == 0 { None } else { Some(7) })
        })
        .expect("polling probe must remain valid");
        let expired = poll_until::<()>(Instant::now(), || Ok(None))
            .expect("elapsed polling probe must remain valid");

        assert_eq!(ready, Some(7));
        assert_eq!(probes.get(), 2);
        assert_eq!(expired, None);
    }

    #[test]
    fn process_state_distinguishes_zombies_from_running_workers() {
        assert_eq!(parse_process_running_state("S+"), Some(true));
        assert_eq!(parse_process_running_state("R"), Some(true));
        assert_eq!(parse_process_running_state("Z"), Some(false));
        assert_eq!(parse_process_running_state("Z+"), Some(false));
        assert_eq!(parse_process_running_state(""), None);
    }

    #[test]
    fn failed_termination_check_kills_the_surviving_worker() {
        let mut worker = Command::new("/bin/sleep")
            .arg("1")
            .spawn()
            .expect("spawn surviving worker");
        let worker_pid = worker.id();

        let survived =
            terminate_worker_if_needed(worker_pid, Instant::now() + Duration::from_millis(10));
        let status = worker.wait().expect("reap cleaned worker");

        assert!(survived, "fixture must exercise cleanup after failure");
        assert!(!status.success(), "cleanup must kill the surviving worker");
        assert!(!process_exists(worker_pid), "cleaned worker must be absent");
    }

    #[test]
    fn process_ordering_io_errors_are_categorized() {
        let probe =
            checked_child_status(Err(io::Error::other("probe failed")), "probe ready wrapper")
                .expect_err("failed wrapper probe must be categorized");
        let wait = checked_child_status(
            Err(io::Error::other("wait failed")),
            "wait for ready wrapper exit",
        )
        .expect_err("failed wrapper wait must be categorized");
        let release = checked_wrapper_release(Err(io::Error::other("release failed")))
            .expect_err("failed wrapper release must be categorized");

        assert_eq!(probe, "probe ready wrapper: probe failed");
        assert_eq!(wait, "wait for ready wrapper exit: wait failed");
        assert_eq!(release, "release ready wrapper: release failed");
    }

    #[test]
    fn reader_and_writer_thread_failures_are_categorized() {
        let writer = std::thread::spawn(|| -> io::Result<()> {
            panic!("synthetic writer panic");
        });
        let writer_error =
            join_writer(writer).expect_err("writer panic must become a typed failure");

        let reader = std::thread::spawn(|| -> io::Result<CapturedStream> {
            panic!("synthetic reader panic");
        });
        let reader_panic = join_reader(reader)
            .map(drop)
            .expect_err("reader panic must become a typed failure");

        let reader =
            std::thread::spawn(|| -> io::Result<CapturedStream> { Err(io::Error::other("read")) });
        let reader_error = join_reader(reader)
            .map(drop)
            .expect_err("reader error must become a typed failure");

        assert_eq!(writer_error.kind(), ValeErrorKind::ProcessFailure);
        assert_eq!(writer_error.message(), "Vale stdin writer thread panicked");
        assert_eq!(reader_panic.kind(), ValeErrorKind::ProcessFailure);
        assert_eq!(reader_panic.message(), "Vale output reader thread panicked");
        assert_eq!(reader_error.kind(), ValeErrorKind::ProcessFailure);
        assert_eq!(reader_error.message(), "could not read Vale output: read");
    }

    fn assert_ready_process_tree_is_terminated(script: &str, wrapper_must_exit: bool) {
        let fixture = ProcessTreeFixture::new();
        let ready_path = fixture.worker_pid.clone();
        let readiness = Rc::new(RefCell::new(None));
        let hook_readiness = Rc::clone(&readiness);
        set_after_spawn_before_deadline(move |child| {
            *hook_readiness.borrow_mut() = Some(wait_for_ready_process_tree(
                &ready_path,
                child,
                wrapper_must_exit,
            ));
        });

        let error = run_process(
            Path::new("/bin/sh"),
            &[OsString::from("-c"), OsString::from(script)],
            &fixture.root,
            ProcessInput::None,
            Duration::from_millis(5),
            1024,
            &CancellationToken::new(),
        )
        .err()
        .expect("ready process tree must time out");

        assert_eq!(error.kind(), ValeErrorKind::Timeout);
        let worker_pid = readiness
            .borrow_mut()
            .take()
            .expect("worker-readiness hook must run")
            .expect("worker must become ready before the synthetic deadline");
        assert_worker_terminated(worker_pid);
    }

    fn wait_for_ready_process_tree(
        path: &Path,
        child: &mut std::process::Child,
        wrapper_must_exit: bool,
    ) -> Result<u32, String> {
        let worker_pid = wait_for_worker_pid(path)?;
        let wrapper_status = checked_child_status(child.try_wait(), "probe ready wrapper")?;
        if wrapper_status.is_some() {
            return Err(
                "ready wrapper exited before its synthetic timeout was established".to_string(),
            );
        }
        if wrapper_must_exit {
            checked_wrapper_release(fs::write(
                path.with_file_name("allow-wrapper-exit"),
                b"ready",
            ))?;
            wait_for_wrapper_exit(child)?;
        }
        Ok(worker_pid)
    }

    fn wait_for_wrapper_exit(child: &mut std::process::Child) -> Result<(), String> {
        wait_for_wrapper_exit_until(child, Instant::now() + Duration::from_secs(2))
    }

    fn wait_for_wrapper_exit_until(
        child: &mut std::process::Child,
        deadline: Instant,
    ) -> Result<(), String> {
        loop {
            std::thread::sleep(Duration::from_millis(2));
            match checked_child_status(child.try_wait(), "wait for ready wrapper exit")? {
                Some(_) => return Ok(()),
                None => {
                    if Instant::now() >= deadline {
                        return Err("ready wrapper did not exit before its deadline".to_string());
                    }
                }
            }
        }
    }

    fn checked_child_status(
        status: io::Result<Option<ExitStatus>>,
        operation: &str,
    ) -> Result<Option<ExitStatus>, String> {
        match status {
            Ok(status) => Ok(status),
            Err(error) => Err(format!("{operation}: {error}")),
        }
    }

    fn checked_wrapper_release(result: io::Result<()>) -> Result<(), String> {
        match result {
            Ok(()) => Ok(()),
            Err(error) => Err(format!("release ready wrapper: {error}")),
        }
    }

    fn wait_for_worker_pid(path: &Path) -> Result<u32, String> {
        wait_for_worker_pid_until(path, Instant::now() + Duration::from_secs(2))
    }

    fn wait_for_worker_pid_until(path: &Path, deadline: Instant) -> Result<u32, String> {
        loop {
            match fs::read_to_string(path) {
                Ok(contents) => {
                    return contents.trim().parse().map_err(|_| {
                        "process-tree fixture recorded a non-numeric worker PID".to_string()
                    })
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if Instant::now() >= deadline {
                        return Err("process-tree worker did not become ready".to_string());
                    }
                }
                Err(error) => return Err(format!("read process-tree worker PID: {error}")),
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn assert_worker_terminated(pid: u32) {
        let survived = terminate_worker_if_needed(pid, Instant::now() + Duration::from_secs(2));
        assert!(!survived, "timed-out process left worker {pid} alive");
    }

    fn terminate_worker_if_needed(pid: u32, deadline: Instant) -> bool {
        while process_exists(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(2));
        }
        let survived = process_exists(pid);
        if survived {
            let _ = Command::new("/bin/kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
        survived
    }

    fn process_exists(pid: u32) -> bool {
        Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("probe process-tree worker")
            .success()
    }

    #[test]
    fn executable_busy_spawn_is_retried() {
        let attempts = Cell::new(0);
        let value = spawn_with_executable_busy_retry(|| {
            let attempt = attempts.get();
            attempts.set(attempt + 1);
            if attempt < 2 {
                Err(std::io::Error::from(rustix::io::Errno::TXTBSY))
            } else {
                Ok(7)
            }
        })
        .expect("third spawn attempt must succeed");

        assert_eq!(value, 7);
        assert_eq!(attempts.get(), 3);
    }

    #[test]
    fn non_busy_spawn_failure_is_not_retried() {
        let attempts = Cell::new(0);
        let error = spawn_with_executable_busy_retry::<()>(|| {
            attempts.set(attempts.get() + 1);
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "denied",
            ))
        })
        .expect_err("non-busy failure must remain immediate");

        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(attempts.get(), 1);
    }
}

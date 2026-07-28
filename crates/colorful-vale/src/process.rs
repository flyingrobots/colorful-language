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

pub(crate) enum ProcessInput {
    None,
    Bytes(Vec<u8>),
}

pub(crate) struct ProcessOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
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
    command
        .args(arguments)
        .current_dir(working_directory)
        .env_remove("VALE_CONFIG_PATH")
        .env_remove("VALE_STYLES_PATH")
        .stdin(if matches!(&input, ProcessInput::Bytes(_)) {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn().map_err(|error| {
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

    let started = Instant::now();
    let process_result = loop {
        if cancellation.is_cancelled() {
            terminate(&mut child);
            break Err(ValeError::new(
                ValeErrorKind::Cancelled,
                "Vale process was cancelled",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() >= timeout => {
                terminate(&mut child);
                break Err(ValeError::new(
                    ValeErrorKind::Timeout,
                    format!("Vale process exceeded {} ms", timeout.as_millis()),
                ));
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                terminate(&mut child);
                break Err(ValeError::new(
                    ValeErrorKind::ProcessFailure,
                    format!("could not poll Vale process: {error}"),
                ));
            }
        }
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

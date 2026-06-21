//! The `colorful` binary: color English prose by part of speech in the terminal.

use std::process::ExitCode;

fn main() -> ExitCode {
    match colorful_cli::run(std::env::args().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("colorful: {err}");
            ExitCode::FAILURE
        }
    }
}

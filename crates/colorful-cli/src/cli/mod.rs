mod args;
mod color;
mod diagnose;
mod format;
mod lint;

pub use args::run;
pub use color::{colorize, decide_color, try_colorize};
pub use lint::{line_col, lint_report};

#[cfg(test)]
mod tests;

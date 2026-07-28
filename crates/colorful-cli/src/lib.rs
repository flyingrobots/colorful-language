//! Colorize English prose by part of speech in the terminal.
//!
//! This is a driving adapter: it wires the
//! [`colorful_parse::ProseParser`] and
//! [`colorful_lexicon::ContextualOpenClassAnnotator`] together and renders
//! the classified token stream as ANSI-colored text. The same classification
//! feeds the LSP server; here it lands as color in a terminal with no editor.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod cli;

pub use cli::{colorize, decide_color, line_col, lint_report, run, try_colorize};

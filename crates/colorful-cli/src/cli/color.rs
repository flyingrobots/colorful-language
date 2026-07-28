use super::args::{parse_input_args, Command, ParseOutcome};
use colorful_core::{ClassificationError, PosClass, ValidatedClassification};
use colorful_lexicon::{ContextualOpenClassAnnotator, SeedOpenClassLexicon};
use colorful_parse::ProseParser;
use std::io::{self, Read, Write};

/// The manifest projection for an optional role, or `None` if the role is
/// absent (an uncovered token-axis combination) or itself has no manifest
/// entry (a drifted manifest). Shared by [`sgr`] and [`diagnose_json`] so the
/// "missing role/projection degrades to no styling" contract lives in one
/// place and is directly testable.
pub(super) fn projection_for(
    role: Option<&colorful_ir::vocabulary_v1::VisualRole>,
) -> Option<&'static colorful_ir::vocabulary::RoleProjection> {
    role.and_then(colorful_ir::vocabulary::projection)
}

/// The ANSI SGR parameter used to color a class, or `None` to leave it plain.
///
/// The colors are not chosen here: the class maps to an abstract `VisualRole`,
/// which the `colorful.vocabulary/v1` manifest projects onto ANSI. The same
/// manifest drives the LSP and the graft consumer, so all three surfaces agree.
fn sgr(class: PosClass) -> Option<&'static str> {
    let role = colorful_ir::vocabulary::visual_role_for(class);
    projection_for(role.as_ref())?.ansi.as_deref()
}

pub(super) fn default_annotator() -> ContextualOpenClassAnnotator<SeedOpenClassLexicon> {
    ContextualOpenClassAnnotator::default()
}

/// Render `source` with ANSI color per part of speech.
///
/// When `color` is `false`, `source` is returned unchanged (a faithful
/// passthrough), so piping through the tool never alters the text.
///
/// The built-in parser and annotator are validated before their spans are
/// sliced. If that invariant ever regresses, this compatibility wrapper fails
/// closed to the unchanged source; use [`try_colorize`] to receive the typed
/// error.
#[must_use]
pub fn colorize(source: &str, color: bool) -> String {
    try_colorize(source, color).unwrap_or_else(|_| source.to_string())
}

/// Render `source` with ANSI color after validating built-in adapter output.
///
/// When `color` is `false`, parsing is skipped and `source` is returned
/// unchanged.
///
/// # Errors
///
/// Returns a typed, path-addressed [`ClassificationError`] if the built-in
/// parser or annotator emits malformed spans or inconsistent tree/token data.
pub fn try_colorize(source: &str, color: bool) -> Result<String, ClassificationError> {
    if !color {
        return Ok(source.to_string());
    }

    let classification =
        ValidatedClassification::from_ports(source, &ProseParser::new(), &default_annotator())?;
    let tokens = classification.tokens();

    let mut out = String::with_capacity(source.len() + tokens.len() * 8);
    let mut prev = 0;
    for token in tokens {
        // Emit the gap (whitespace and anything between tokens) verbatim.
        if token.span.start > prev {
            out.push_str(source.get(prev..token.span.start).unwrap_or(""));
        }
        let text = token.span.slice(source);
        if let Some(code) = sgr(token.class) {
            out.push_str("\x1b[");
            out.push_str(code);
            out.push('m');
            out.push_str(text);
            out.push_str("\x1b[0m");
        } else {
            out.push_str(text);
        }
        prev = token.span.end;
    }
    if prev < source.len() {
        out.push_str(source.get(prev..).unwrap_or(""));
    }
    Ok(out)
}

/// Decide whether to emit color, honoring `--no-color` and the `NO_COLOR`
/// convention (<https://no-color.org/>): color is on unless either is set.
#[must_use]
pub fn decide_color(no_color_flag: bool, no_color_env: bool) -> bool {
    !no_color_flag && !no_color_env
}

/// Colorize prose to ANSI in the terminal (the default subcommand).
pub(super) fn run_color<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let parsed = match parse_input_args(Command::Color, args)? {
        ParseOutcome::Help => {
            print!("{}", Command::Color.help_text());
            return Ok(());
        }
        ParseOutcome::Run(parsed) => parsed,
    };

    let color = decide_color(
        parsed.has_flag("--no-color"),
        std::env::var_os("NO_COLOR").is_some(),
    );
    let input = match parsed.path {
        Some(p) => std::fs::read_to_string(p)?,
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            buf
        }
    };
    let mut stdout = io::stdout().lock();
    let output = try_colorize(&input, color).map_err(classification_io_error)?;
    stdout.write_all(output.as_bytes())?;
    stdout.flush()
}

pub(super) fn classification_io_error(error: ClassificationError) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error)
}

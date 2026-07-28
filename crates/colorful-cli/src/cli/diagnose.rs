use super::args::{parse_input_args, Command, ParseOutcome};
use super::color::{default_annotator, projection_for};
use super::lint::line_col;
use colorful_core::{Analyzer, Severity};
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;
use std::io::{self, Read, Write};

pub(super) fn analyze_ir(
    unit_id: &str,
    input: &str,
) -> Result<colorful_ir::syntax_v1::DocumentAnalysis, colorful_projection::ProjectionError> {
    let parser = ProseParser::new();
    let annotator = default_annotator();
    colorful_projection::build_document(unit_id, input, &parser, &annotator)
        .map(|analyzed| analyzed.document)
}

fn json_error(err: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, err.to_string())
}

/// Emit the `colorful.syntax/v1` IR (`DocumentAnalysis`) as canonical JSON.
///
/// `colorful ir [FILE]` — reads the file (or stdin), parses and classifies it,
/// and prints the IR a back-end (graft, jedit, an editor) can consume.
pub(super) fn run_ir<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let parsed = match parse_input_args(Command::Ir, args)? {
        ParseOutcome::Help => {
            print!("{}", Command::Ir.help_text());
            return Ok(());
        }
        ParseOutcome::Run(parsed) => parsed,
    };

    let (unit_id, input) = match parsed.path {
        Some(p) => {
            let contents = std::fs::read_to_string(&p)?;
            (p, contents)
        }
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            ("stdin".to_string(), buf)
        }
    };

    let document = analyze_ir(&unit_id, &input)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    let json = colorful_ir::canonical_json(&document)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;

    let mut stdout = io::stdout().lock();
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

/// Emit a troubleshooting report for CLI/editor projection checks.
///
/// `colorful diagnose --json [FILE]` — reads the file (or stdin), parses and
/// classifies it through the default production path, and prints a decoded JSON
/// report showing each token's IR axes and presentation projection.
pub(super) fn run_diagnose<I>(args: I) -> io::Result<()>
where
    I: IntoIterator<Item = String>,
{
    let parsed = match parse_input_args(Command::Diagnose, args)? {
        ParseOutcome::Help => {
            print!("{}", Command::Diagnose.help_text());
            return Ok(());
        }
        ParseOutcome::Run(parsed) => parsed,
    };

    let (unit_id, input) = match parsed.path {
        Some(p) => {
            let contents = std::fs::read_to_string(&p)?;
            (p, contents)
        }
        None => {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            ("stdin".to_string(), buf)
        }
    };

    let json = diagnose_json(&unit_id, &input)?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

pub(super) fn diagnose_json(unit_id: &str, input: &str) -> io::Result<String> {
    let parser = ProseParser::new();
    let annotator = default_annotator();
    let analyzer = ProseLinter::new();

    let colorful_projection::AnalyzedDocument {
        tree,
        tokens,
        document,
    } = colorful_projection::build_document(unit_id, input, &parser, &annotator)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
    let findings = analyzer.analyze(input, &tree, &tokens);
    let legend = colorful_ir::vocabulary::lsp_legend();

    let mut lsp_semantic_tokens = 0usize;
    let mut ansi_colored_tokens = 0usize;
    let mut graft_styled_tokens = 0usize;
    let mut report_tokens = Vec::with_capacity(document.tokens.len());

    for token in &document.tokens {
        let role = colorful_ir::vocabulary::visual_role(
            &token.token_kind,
            token.lexical_class.as_ref(),
            token.open_class_kind.as_ref(),
        );
        let projection = projection_for(role.as_ref());
        let lsp_token_type = projection.and_then(|projection| projection.lsp_token_type.as_deref());
        let lsp_token_type_index =
            lsp_token_type.and_then(|name| legend.iter().position(|candidate| *candidate == name));

        if lsp_token_type.is_some() {
            lsp_semantic_tokens += 1;
        }
        if projection
            .and_then(|projection| projection.ansi.as_ref())
            .is_some()
        {
            ansi_colored_tokens += 1;
        }
        if projection
            .and_then(|projection| projection.graft_class.as_ref())
            .is_some()
        {
            graft_styled_tokens += 1;
        }

        report_tokens.push(serde_json::json!({
            "occurrenceId": token.occurrence_id,
            "text": range_text(input, &token.byte_range),
            "byteRange": token.byte_range,
            "tokenKind": token.token_kind,
            "lexicalClass": token.lexical_class,
            "functionKind": token.function_kind,
            "openClassKind": token.open_class_kind,
            "visualRole": role,
            "ansi": projection.and_then(|projection| projection.ansi.as_deref()),
            "graftClass": projection.and_then(|projection| projection.graft_class.as_deref()),
            "lspTokenType": lsp_token_type,
            "lspTokenTypeIndex": lsp_token_type_index,
        }));
    }

    let diagnostics: Vec<_> = findings
        .iter()
        .map(|finding| {
            let (line, column) = line_col(input, finding.span.start);
            serde_json::json!({
                "byteRange": {
                    "startUtf8": finding.span.start,
                    "endUtf8": finding.span.end,
                },
                "line": line,
                "column": column,
                "severity": severity_name(finding.severity),
                "code": finding.rule.code(),
                "message": finding.message,
                "text": finding.span.slice(input),
            })
        })
        .collect();

    let report = serde_json::json!({
        "reportVersion": "colorful.diagnose/v1",
        "tool": {
            "name": "colorful",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "source": document.source,
        "contracts": {
            "syntax": {
                "contractVersion": document.contract_version,
                "schemaHash": document.schema_hash,
            },
            "vocabulary": {
                "hash": document.vocabulary_hash,
                "lspLegend": legend,
            },
        },
        "summary": {
            "tokens": report_tokens.len(),
            "ansiColoredTokens": ansi_colored_tokens,
            "graftStyledTokens": graft_styled_tokens,
            "lspSemanticTokens": lsp_semantic_tokens,
            "diagnostics": diagnostics.len(),
        },
        "tokens": report_tokens,
        "diagnostics": diagnostics,
    });

    colorful_ir::canonical_json(&report).map_err(json_error)
}

fn range_text<'a>(source: &'a str, range: &colorful_ir::syntax_v1::ByteRange) -> &'a str {
    let Ok(start) = usize::try_from(range.start_utf8) else {
        return "";
    };
    let Ok(end) = usize::try_from(range.end_utf8) else {
        return "";
    };
    source.get(start..end).unwrap_or("")
}

fn severity_name(severity: Severity) -> &'static str {
    match severity {
        Severity::Warning => "WARNING",
        Severity::Info => "INFO",
    }
}

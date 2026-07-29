use std::collections::BTreeMap;
use std::fmt;

use colorful_core::{Finding, Rule, Severity, Span};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};

use crate::{ValeError, ValeErrorKind};

#[cfg(test)]
thread_local! {
    static RESPONSE_DESERIALIZATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static LINE_INDEX_CONSTRUCTIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ValeAction {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Params")]
    params: Option<Vec<String>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ValeAlert {
    #[serde(rename = "Action")]
    action: ValeAction,
    #[serde(rename = "Span")]
    span: Vec<i64>,
    #[serde(rename = "Check")]
    check: String,
    #[serde(rename = "Description")]
    description: String,
    #[serde(rename = "Link")]
    link: String,
    #[serde(rename = "Message")]
    message: String,
    #[serde(rename = "Severity")]
    severity: String,
    #[serde(rename = "Match")]
    matched: String,
    #[serde(rename = "Line")]
    line: i64,
}

struct ValeFiles {
    entries: BTreeMap<String, Vec<ValeAlert>>,
    duplicate_source: bool,
}

impl<'de> Deserialize<'de> for ValeFiles {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[cfg(test)]
        RESPONSE_DESERIALIZATIONS.with(|count| count.set(count.get() + 1));

        struct ValeFilesVisitor;

        impl<'de> Visitor<'de> for ValeFilesVisitor {
            type Value = ValeFiles;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an object keyed by one Vale stdin source")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut entries = BTreeMap::new();
                let mut duplicate_source = false;
                while let Some((source, alerts)) = map.next_entry::<String, Vec<ValeAlert>>()? {
                    if entries.insert(source, alerts).is_some() {
                        duplicate_source = true;
                    }
                }
                Ok(ValeFiles {
                    entries,
                    duplicate_source,
                })
            }
        }

        deserializer.deserialize_map(ValeFilesVisitor)
    }
}

struct LineIndex<'source> {
    source: &'source str,
    bounds: Vec<(usize, usize)>,
}

impl<'source> LineIndex<'source> {
    fn new(source: &'source str) -> Self {
        #[cfg(test)]
        LINE_INDEX_CONSTRUCTIONS.with(|count| count.set(count.get() + 1));

        let mut bounds = Vec::new();
        let mut start = 0usize;
        for (index, byte) in source.bytes().enumerate() {
            if byte != b'\n' {
                continue;
            }
            let end = index
                .checked_sub(1)
                .filter(|previous| source.as_bytes()[*previous] == b'\r')
                .unwrap_or(index);
            bounds.push((start, end));
            start = index + 1;
        }
        bounds.push((start, source.len()));
        Self { source, bounds }
    }

    fn source(&self) -> &'source str {
        self.source
    }

    fn bounds(&self, requested_line: usize) -> Option<(usize, usize)> {
        requested_line
            .checked_sub(1)
            .and_then(|index| self.bounds.get(index))
            .copied()
    }
}

pub(crate) fn parse_findings(
    source: &str,
    expected_source: &str,
    json: &str,
) -> Result<Vec<Finding>, ValeError> {
    if !json.trim_start().starts_with('{') {
        return Err(ValeError::new(
            ValeErrorKind::MalformedOutput,
            "Vale JSON output must be an object keyed by one stdin source",
        ));
    }
    let parsed: ValeFiles = serde_json::from_str(json).map_err(|error| {
        let (kind, context) = match error.classify() {
            serde_json::error::Category::Data => (
                ValeErrorKind::InvalidAlert,
                "Vale JSON alert shape is invalid",
            ),
            _ => (
                ValeErrorKind::MalformedOutput,
                "Vale output is not valid JSON",
            ),
        };
        ValeError::new(kind, format!("{context}: {error}"))
    })?;
    if parsed.duplicate_source {
        return Err(ValeError::new(
            ValeErrorKind::MalformedOutput,
            "Vale returned a duplicate source key",
        ));
    }
    let files = parsed.entries;
    if files.len() > 1 {
        return Err(ValeError::new(
            ValeErrorKind::MalformedOutput,
            format!(
                "Vale returned {} source entries for one stdin document",
                files.len()
            ),
        ));
    }
    if let Some(actual_source) = files.keys().next() {
        if actual_source != expected_source {
            return Err(ValeError::new(
                ValeErrorKind::SourceMismatch,
                "Vale returned an unexpected source key",
            ));
        }
    }

    let line_index = LineIndex::new(source);
    let mut findings = Vec::new();
    for alert in files.into_values().flatten() {
        findings.push(normalize_alert(&line_index, alert)?);
    }
    findings.sort_by(|left, right| {
        left.span
            .start
            .cmp(&right.span.start)
            .then_with(|| left.span.end.cmp(&right.span.end))
            .then_with(|| left.rule.code().cmp(right.rule.code()))
            .then_with(|| severity_rank(left.severity).cmp(&severity_rank(right.severity)))
            .then_with(|| left.message.cmp(&right.message))
    });
    Ok(findings)
}

fn normalize_alert(line_index: &LineIndex<'_>, alert: ValeAlert) -> Result<Finding, ValeError> {
    let source = line_index.source();
    if alert.check.is_empty() {
        return Err(invalid_alert("Vale alert check is empty"));
    }
    if alert.message.is_empty() {
        return Err(invalid_alert(format!(
            "{} alert message is empty",
            alert.check
        )));
    }
    if alert.matched.is_empty() {
        return Err(invalid_alert(format!(
            "{} alert match is empty",
            alert.check
        )));
    }
    if alert.span.len() != 2 {
        return Err(invalid_alert(format!(
            "{} has {} span elements; expected two",
            alert.check,
            alert.span.len()
        )));
    }
    let line = usize::try_from(alert.line)
        .ok()
        .filter(|line| *line > 0)
        .ok_or_else(|| invalid_alert(format!("{} has invalid line {}", alert.check, alert.line)))?;
    let start_column = usize::try_from(alert.span[0])
        .ok()
        .filter(|column| *column > 0);
    let end_column = usize::try_from(alert.span[1])
        .ok()
        .filter(|column| *column > 0);
    let (start_column, end_column) = match (start_column, end_column) {
        (Some(start), Some(end)) if start <= end => (start, end),
        _ => {
            return Err(invalid_alert(format!(
                "{} has invalid inclusive columns {:?}",
                alert.check, alert.span
            )))
        }
    };
    let (line_start, line_end) = line_index.bounds(line).ok_or_else(|| {
        invalid_alert(format!(
            "{} line {} is outside the source",
            alert.check, alert.line
        ))
    })?;
    let line_source = &source[line_start..line_end];
    let start = scalar_boundary(line_source, start_column - 1).ok_or_else(|| {
        invalid_alert(format!(
            "{} start column {} is outside line {}",
            alert.check, start_column, line
        ))
    })?;
    let end = scalar_boundary(line_source, end_column).ok_or_else(|| {
        invalid_alert(format!(
            "{} end column {} is outside line {}",
            alert.check, end_column, line
        ))
    })?;
    if start == end {
        return Err(invalid_alert(format!(
            "{} has an empty normalized span",
            alert.check
        )));
    }
    let span = Span::new(line_start + start, line_start + end);
    if span.slice(source) != alert.matched {
        return Err(invalid_alert(format!(
            "{} match {:?} does not equal source slice {:?}",
            alert.check,
            alert.matched,
            span.slice(source)
        )));
    }
    let rule = Rule::external(format!("vale/{}", alert.check))
        .map_err(|error| invalid_alert(error.to_string()))?;
    let severity = match alert.severity.as_str() {
        "suggestion" => Severity::Info,
        // Colorful has no error tier; Warning is its highest editorial severity.
        "warning" | "error" => Severity::Warning,
        other => {
            return Err(invalid_alert(format!(
                "{} has unsupported severity {other:?}",
                alert.check
            )))
        }
    };
    Ok(Finding {
        span,
        rule,
        severity,
        message: alert.message,
    })
}

fn scalar_boundary(source: &str, scalar_index: usize) -> Option<usize> {
    if scalar_index == source.chars().count() {
        return Some(source.len());
    }
    source
        .char_indices()
        .nth(scalar_index)
        .map(|(byte, _)| byte)
}

fn severity_rank(severity: Severity) -> u8 {
    match severity {
        Severity::Info => 0,
        Severity::Warning => 1,
    }
}

fn invalid_alert(message: impl Into<String>) -> ValeError {
    ValeError::new(ValeErrorKind::InvalidAlert, message)
}

#[cfg(test)]
mod tests {
    use super::{parse_findings, LineIndex, LINE_INDEX_CONSTRUCTIONS, RESPONSE_DESERIALIZATIONS};

    #[test]
    fn line_index_preserves_crlf_and_terminal_empty_lines() {
        let source = "one\r\ntwo\n";
        let index = LineIndex::new(source);

        assert_eq!(index.bounds(0), None);
        assert_eq!(index.bounds(1), Some((0, 3)));
        assert_eq!(index.bounds(2), Some((5, 8)));
        assert_eq!(index.bounds(3), Some((9, 9)));
        assert_eq!(index.bounds(4), None);
    }

    #[test]
    fn one_response_deserializes_and_indexes_once() {
        let json = r#"{
  "stdin.txt": [
    {
      "Action": {"Name": "", "Params": null},
      "Span": [1, 3],
      "Check": "Style.One",
      "Description": "",
      "Link": "",
      "Message": "First.",
      "Severity": "warning",
      "Match": "one",
      "Line": 1
    },
    {
      "Action": {"Name": "", "Params": null},
      "Span": [5, 7],
      "Check": "Style.Two",
      "Description": "",
      "Link": "",
      "Message": "Second.",
      "Severity": "suggestion",
      "Match": "two",
      "Line": 1
    }
  ]
}"#;
        RESPONSE_DESERIALIZATIONS.with(|count| count.set(0));
        LINE_INDEX_CONSTRUCTIONS.with(|count| count.set(0));

        let findings = parse_findings("one two", "stdin.txt", json).expect("parse two alerts");

        assert_eq!(findings.len(), 2);
        RESPONSE_DESERIALIZATIONS.with(|count| assert_eq!(count.get(), 1));
        LINE_INDEX_CONSTRUCTIONS.with(|count| assert_eq!(count.get(), 1));
    }
}

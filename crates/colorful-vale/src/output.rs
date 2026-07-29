use std::collections::BTreeMap;
use std::fmt;

use colorful_core::{Finding, Rule, Severity, Span};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};

use crate::{ValeError, ValeErrorKind};

const ALERT_ERROR_DETAIL_LIMIT: usize = 512;
const ALERT_ERROR_TRUNCATION_SUFFIX: &str = " [truncated]";
const VALE_RULE_PREFIX: &str = "vale/";
const MAX_EXTERNAL_RULE_CODE_BYTES: usize = 128;

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
        if error.classify() == serde_json::error::Category::Data {
            invalid_alert("Vale JSON alert shape is invalid")
        } else {
            ValeError::new(
                ValeErrorKind::MalformedOutput,
                format!("Vale output is not valid JSON: {error}"),
            )
        }
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
    let alert_context = format!("Vale alert check ({} bytes)", alert.check.len());
    if alert.message.is_empty() {
        return Err(invalid_alert(format!(
            "{alert_context} has an empty message"
        )));
    }
    if alert.matched.is_empty() {
        return Err(invalid_alert(format!("{alert_context} has an empty match")));
    }
    if alert.span.len() != 2 {
        return Err(invalid_alert(format!(
            "{alert_context} has {} span elements; expected two",
            alert.span.len()
        )));
    }
    let line = usize::try_from(alert.line)
        .ok()
        .filter(|line| *line > 0)
        .ok_or_else(|| invalid_alert(format!("{alert_context} has invalid line {}", alert.line)))?;
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
                "{alert_context} has invalid inclusive columns ({}, {})",
                alert.span[0], alert.span[1]
            )))
        }
    };
    let (line_start, line_end) = line_index.bounds(line).ok_or_else(|| {
        invalid_alert(format!(
            "{alert_context} line {} is outside the source",
            alert.line
        ))
    })?;
    let line_source = &source[line_start..line_end];
    let start = scalar_boundary(line_source, start_column - 1).ok_or_else(|| {
        invalid_alert(format!(
            "{alert_context} start column {start_column} is outside line {line}"
        ))
    })?;
    let end = scalar_boundary(line_source, end_column).ok_or_else(|| {
        invalid_alert(format!(
            "{alert_context} end column {end_column} is outside line {line}"
        ))
    })?;
    if start == end {
        return Err(invalid_alert(format!(
            "{alert_context} has an empty normalized span"
        )));
    }
    let span = Span::new(line_start + start, line_start + end);
    if span.slice(source) != alert.matched {
        return Err(invalid_alert(format!(
            "{alert_context} match length {} does not equal source slice length {}",
            alert.matched.len(),
            span.len()
        )));
    }
    if alert.check.len() > MAX_EXTERNAL_RULE_CODE_BYTES - VALE_RULE_PREFIX.len() {
        return Err(invalid_alert(format!(
            "{alert_context} cannot form an external rule code"
        )));
    }
    let rule = Rule::external(format!("{VALE_RULE_PREFIX}{}", alert.check))
        .map_err(|_| invalid_alert(format!("{alert_context} cannot form an external rule code")))?;
    let severity = match alert.severity.as_str() {
        "suggestion" => Severity::Info,
        // Colorful has no error tier; Warning is its highest editorial severity.
        "warning" | "error" => Severity::Warning,
        _ => {
            return Err(invalid_alert(format!(
                "{alert_context} has unsupported severity ({} bytes)",
                alert.severity.len()
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
    let mut message = message.into();
    if message.len() > ALERT_ERROR_DETAIL_LIMIT {
        let mut end = ALERT_ERROR_DETAIL_LIMIT - ALERT_ERROR_TRUNCATION_SUFFIX.len();
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
        message.push_str(ALERT_ERROR_TRUNCATION_SUFFIX);
    }
    ValeError::new(ValeErrorKind::InvalidAlert, message)
}

#[cfg(test)]
mod tests {
    use super::{
        invalid_alert, parse_findings, LineIndex, ALERT_ERROR_DETAIL_LIMIT,
        ALERT_ERROR_TRUNCATION_SUFFIX, LINE_INDEX_CONSTRUCTIONS, RESPONSE_DESERIALIZATIONS,
    };
    use crate::{ValeError, ValeErrorKind};
    use serde_json::json;

    fn alert_json(
        check: &str,
        message: &str,
        matched: &str,
        severity: &str,
        span: [i64; 2],
    ) -> String {
        json!({
            "stdin.txt": [{
                "Action": {"Name": "", "Params": null},
                "Span": span,
                "Check": check,
                "Description": "",
                "Link": "",
                "Message": message,
                "Severity": severity,
                "Match": matched,
                "Line": 1
            }]
        })
        .to_string()
    }

    fn rejected_alert(source: &str, json: &str) -> ValeError {
        parse_findings(source, "stdin.txt", json).expect_err("malformed alert must fail closed")
    }

    fn assert_bounded_redacted(error: &ValeError, sentinel: &str) {
        assert_eq!(error.kind(), ValeErrorKind::InvalidAlert);
        assert!(
            error.message().len() <= ALERT_ERROR_DETAIL_LIMIT,
            "invalid-alert detail used {} bytes; expected at most {ALERT_ERROR_DETAIL_LIMIT}",
            error.message().len()
        );
        assert!(
            !error.message().contains(sentinel),
            "invalid-alert detail reproduced the complete external sentinel"
        );
    }

    #[test]
    fn oversized_check_is_bounded_and_redacted() {
        let check = "CHECK-SENTINEL-".repeat(256);
        let json = alert_json(&check, "", "x", "warning", [1, 1]);

        let error = rejected_alert("x", &json);

        assert_bounded_redacted(&error, &check);
    }

    #[test]
    fn oversized_match_is_bounded_and_redacted() {
        let matched = "MATCH-SENTINEL-".repeat(256);
        let json = alert_json("Style.Safe", "message", &matched, "warning", [1, 1]);

        let error = rejected_alert("x", &json);

        assert_bounded_redacted(&error, &matched);
    }

    #[test]
    fn oversized_unsupported_severity_is_bounded_and_redacted() {
        let severity = "SEVERITY-SENTINEL-".repeat(256);
        let json = alert_json("Style.Safe", "message", "x", &severity, [1, 1]);

        let error = rejected_alert("x", &json);

        assert_bounded_redacted(&error, &severity);
    }

    #[test]
    fn mismatched_source_slice_is_bounded_and_redacted() {
        let source = "SOURCE-SENTINEL-".repeat(256);
        let end = i64::try_from(source.chars().count()).expect("fixture length fits in i64");
        let json = alert_json(
            "Style.Safe",
            "message",
            "not-the-source",
            "warning",
            [1, end],
        );

        let error = rejected_alert(&source, &json);

        assert_bounded_redacted(&error, &source);
    }

    #[test]
    fn oversized_typed_field_error_is_bounded_and_redacted() {
        let line = "LINE-SENTINEL-".repeat(256);
        let json = json!({
            "stdin.txt": [{
                "Action": {"Name": "", "Params": null},
                "Span": [1, 1],
                "Check": "Style.Safe",
                "Description": "",
                "Link": "",
                "Message": "message",
                "Severity": "warning",
                "Match": "x",
                "Line": line
            }]
        })
        .to_string();

        let error = rejected_alert("x", &json);

        assert_bounded_redacted(&error, &line);
    }

    #[test]
    fn invalid_external_rule_check_is_redacted() {
        let check = "CHECK SENTINEL";
        let json = alert_json(check, "message", "x", "warning", [1, 1]);

        let error = rejected_alert("x", &json);

        assert_bounded_redacted(&error, check);
        assert_eq!(
            error.message(),
            "Vale alert check (14 bytes) cannot form an external rule code"
        );
    }

    #[test]
    fn invalid_alert_limit_preserves_utf8_and_the_exact_byte_budget() {
        let error = invalid_alert("é".repeat(ALERT_ERROR_DETAIL_LIMIT));

        assert_eq!(error.message().len(), ALERT_ERROR_DETAIL_LIMIT);
        assert!(error.message().ends_with(ALERT_ERROR_TRUNCATION_SUFFIX));
        assert!(std::str::from_utf8(error.message().as_bytes()).is_ok());
    }

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

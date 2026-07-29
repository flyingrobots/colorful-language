//! Markdown-to-prose adaptation without moving source coordinates.

use std::borrow::Cow;
use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

#[derive(Debug)]
struct ExcludedRange {
    bytes: Range<usize>,
    separates_prose: bool,
}

impl ExcludedRange {
    fn inline(bytes: Range<usize>) -> Self {
        Self {
            bytes,
            separates_prose: false,
        }
    }

    fn block(bytes: Range<usize>) -> Self {
        Self {
            bytes,
            separates_prose: true,
        }
    }
}

#[derive(Debug, Default)]
struct MarkdownRanges {
    excluded: Vec<ExcludedRange>,
    inline_links: Vec<Range<usize>>,
    rendered: Vec<Range<usize>>,
}

/// Replace reviewed Markdown non-prose regions with coordinate-equivalent
/// whitespace and non-emitting sentence separators.
///
/// Text outside those regions is returned byte-for-byte. The returned text has
/// the same byte length, line endings, and UTF-16 length before every retained
/// prose byte, so findings and semantic roles can be projected directly onto
/// the original source.
///
/// ```
/// use colorful_parse::markdown::mask_non_prose;
///
/// let source = "Prose.\n\n```text\nThe cat connects.\n```\n";
/// let masked = mask_non_prose(source);
///
/// assert!(masked.starts_with("Prose.\n\n"));
/// assert!(masked["Prose.\n\n".len()..]
///     .chars()
///     .all(|character| character.is_whitespace() || character == '.'));
/// assert_eq!(masked.len(), source.len());
/// assert_eq!(masked.encode_utf16().count(), source.encode_utf16().count());
/// ```
#[must_use]
pub fn mask_non_prose(source: &str) -> Cow<'_, str> {
    let mut ranges = parser_ranges(source);
    for link in ranges.inline_links {
        if let Some(destination) = inline_link_destination_range(source, link) {
            ranges.excluded.push(ExcludedRange::inline(destination));
        }
    }
    let ranges = merge_ranges(source, ranges.excluded);
    if ranges.is_empty() {
        return Cow::Borrowed(source);
    }

    let mut masked = String::with_capacity(source.len());
    let mut copied_until = 0usize;
    for range in ranges {
        masked.push_str(&source[copied_until..range.bytes.start]);
        push_coordinate_mask(
            &mut masked,
            &source[range.bytes.clone()],
            range.separates_prose,
        );
        copied_until = range.bytes.end;
    }
    masked.push_str(&source[copied_until..]);
    assert_eq!(masked.len(), source.len());
    assert_eq!(masked.encode_utf16().count(), source.encode_utf16().count());
    Cow::Owned(masked)
}

fn parser_ranges(source: &str) -> MarkdownRanges {
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS;
    let parser = Parser::new_ext(source, options);
    let mut ranges = MarkdownRanges {
        excluded: parser
            .reference_definitions()
            .iter()
            .map(|(_, definition)| ExcludedRange::block(definition.span.clone()))
            .collect(),
        inline_links: Vec::new(),
        rendered: Vec::new(),
    };
    let mut code_block_start = None;
    let mut metadata_block_start = None;

    for (event, range) in parser.into_offset_iter() {
        if !matches!(&event, Event::Start(_) | Event::End(_)) {
            ranges.rendered.push(range.clone());
        }
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_block_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    ranges.excluded.push(ExcludedRange::block(start..range.end));
                }
            }
            Event::Start(Tag::MetadataBlock(_)) => metadata_block_start = Some(range.start),
            Event::End(TagEnd::MetadataBlock(_)) => {
                if let Some(start) = metadata_block_start.take() {
                    ranges.excluded.push(ExcludedRange::block(start..range.end));
                }
            }
            Event::Start(
                Tag::Link {
                    link_type: LinkType::Inline,
                    ..
                }
                | Tag::Image {
                    link_type: LinkType::Inline,
                    ..
                },
            ) => ranges.inline_links.push(range),
            Event::Start(Tag::Link {
                link_type: LinkType::Autolink | LinkType::Email,
                ..
            }) => ranges.excluded.push(ExcludedRange::inline(range)),
            Event::Html(_) => {
                ranges.excluded.push(ExcludedRange::block(range));
            }
            Event::Code(_) | Event::InlineHtml(_) => {
                ranges.excluded.push(ExcludedRange::inline(range));
            }
            _ => {}
        }
    }
    ranges.excluded.extend(hidden_reference_definition_ranges(
        source,
        &mut ranges.rendered,
    ));
    ranges
}

fn hidden_reference_definition_ranges(
    source: &str,
    rendered: &mut [Range<usize>],
) -> Vec<ExcludedRange> {
    rendered.sort_unstable_by_key(|range| (range.start, range.end));
    let bytes = source.as_bytes();
    let mut hidden = Vec::new();
    let mut line_start = 0usize;

    while line_start < bytes.len() {
        let content_end = bytes[line_start..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
            .map_or(bytes.len(), |offset| line_start + offset);
        let terminator_len = match bytes.get(content_end..) {
            Some([b'\r', b'\n', ..]) => 2,
            Some([b'\r' | b'\n', ..]) => 1,
            _ => 0,
        };
        let line_end = content_end + terminator_len;
        let content = &source[line_start..content_end];

        if has_reference_definition_marker(content) {
            let first_possible = rendered.partition_point(|range| range.end <= line_start);
            let overlaps_rendered = rendered
                .get(first_possible)
                .is_some_and(|range| range.start < content_end);
            if !overlaps_rendered {
                let next_rendered = rendered.partition_point(|range| range.start < line_end);
                let hidden_end = rendered
                    .get(next_rendered)
                    .map_or(source.len(), |range| range.start);
                hidden.push(ExcludedRange::block(line_start..hidden_end));
            }
        }

        line_start = line_end;
    }
    hidden
}

fn has_reference_definition_marker(line: &str) -> bool {
    let bytes = line.as_bytes();
    let indent = bytes.iter().take_while(|byte| **byte == b' ').count();
    if indent > 3 || bytes.get(indent) != Some(&b'[') {
        return false;
    }

    let mut cursor = indent + 1;
    while let Some(byte) = bytes.get(cursor) {
        match byte {
            b'\\' => cursor = cursor.saturating_add(2),
            b']' => return bytes.get(cursor + 1) == Some(&b':'),
            _ => cursor += 1,
        }
    }
    false
}

fn inline_link_destination_range(source: &str, link: Range<usize>) -> Option<Range<usize>> {
    let bytes = source.as_bytes();
    let mut cursor = link.start;

    while cursor + 1 < link.end {
        if bytes[cursor] != b']' || bytes[cursor + 1] != b'(' {
            cursor += 1;
            continue;
        }
        let start = cursor + 1;
        let mut depth = 0usize;
        let mut end = None;
        let mut candidate = start;
        let mut angle_destination = false;
        let mut title_expected = false;
        let mut title_quote = None;
        while candidate < link.end {
            let byte = bytes[candidate];
            if byte == b'\\' {
                candidate = candidate.saturating_add(2);
                continue;
            }
            if let Some(quote) = title_quote {
                if byte == quote {
                    title_quote = None;
                }
                candidate += 1;
                continue;
            }
            if angle_destination {
                angle_destination = byte != b'>';
                candidate += 1;
                continue;
            }
            if depth == 1 && byte.is_ascii_whitespace() {
                title_expected = true;
                candidate += 1;
                continue;
            }
            if title_expected && matches!(byte, b'\'' | b'"') {
                title_quote = Some(byte);
                title_expected = false;
                candidate += 1;
                continue;
            }
            title_expected = false;

            match byte {
                b'<' if depth == 1 => {
                    angle_destination = true;
                    candidate += 1;
                }
                b'(' => {
                    depth += 1;
                    candidate += 1;
                }
                b')' => {
                    depth = depth.saturating_sub(1);
                    candidate += 1;
                    if depth == 0 {
                        end = Some(candidate);
                        break;
                    }
                }
                _ => candidate += 1,
            }
        }
        if let Some(end) = end {
            if end == link.end {
                return Some(start..end);
            }
            cursor = end;
        } else {
            cursor += 2;
        }
    }
    None
}

fn merge_ranges(source: &str, mut ranges: Vec<ExcludedRange>) -> Vec<ExcludedRange> {
    ranges.retain(|range| {
        range.bytes.start < range.bytes.end
            && range.bytes.end <= source.len()
            && source.is_char_boundary(range.bytes.start)
            && source.is_char_boundary(range.bytes.end)
    });
    ranges.sort_unstable_by_key(|range| (range.bytes.start, range.bytes.end));

    let mut merged: Vec<ExcludedRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut() {
            if range.bytes.start <= previous.bytes.end {
                previous.bytes.end = previous.bytes.end.max(range.bytes.end);
                previous.separates_prose |= range.separates_prose;
                continue;
            }
        }
        merged.push(range);
    }
    merged
}

fn push_coordinate_mask(output: &mut String, source: &str, separates_prose: bool) {
    let separator_offset = separates_prose
        .then(|| {
            source
                .char_indices()
                .find(|(_, character)| {
                    !matches!(character, '\n' | '\r') && character.len_utf8() == 1
                })
                .map(|(offset, _)| offset)
        })
        .flatten();

    for (offset, character) in source.char_indices() {
        match character {
            '\n' | '\r' => output.push(character),
            _ if separator_offset == Some(offset) => output.push('.'),
            _ => match character.len_utf8() {
                1 => output.push(' '),
                2 => output.push('\u{00A0}'),
                3 => output.push('\u{3000}'),
                4 => output.push_str("\u{00A0}\u{00A0}"),
                _ => unreachable!("UTF-8 scalars occupy one to four bytes"),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::mask_non_prose;

    fn assert_masked(source: &str, needle: &str) {
        let start = source.find(needle).expect("fixture needle");
        let end = start + needle.len();
        let masked = mask_non_prose(source);
        let masked_needle = &masked[start..end];
        assert!(
            masked_needle
                .chars()
                .all(|character| character.is_whitespace() || character == '.'),
            "{needle:?} remained analyzable in {masked:?}"
        );
        assert!(masked_needle.matches('.').count() <= 1, "{masked:?}");
    }

    fn utf16_len(text: &str) -> usize {
        text.encode_utf16().count()
    }

    #[test]
    fn fenced_code_is_whitespace_while_surrounding_prose_is_unchanged() {
        let source = concat!(
            "This is really prose.\n\n",
            "```rust\n",
            "This is really code. 😀\n",
            "```\n\n",
            "The cat connects.\n",
        );
        let masked = mask_non_prose(source);

        assert!(masked.starts_with("This is really prose.\n\n"));
        assert!(masked.ends_with("\n\nThe cat connects.\n"));
        assert_masked(source, "```rust\nThis is really code. 😀\n```");
    }

    #[test]
    fn reviewed_markdown_regions_have_explicit_suppression_decisions() {
        let cases = [
            ("Prose `really weak` remains.", "really weak"),
            ("Prose.\n\n    really weak\n\nMore prose.", "really weak"),
            ("---\nreally: weak\n---\nProse really.", "really: weak"),
            (
                "+++\nreally = \"weak\"\n+++\nProse really.",
                "really = \"weak\"",
            ),
            (
                "[really weak](https://really.example/weak)",
                "https://really.example/weak",
            ),
            ("<div>\nreally weak\n</div>\nProse really.", "really weak"),
        ];

        for (source, excluded) in cases {
            assert_masked(source, excluded);
        }
    }

    #[test]
    fn link_labels_remain_prose_while_destinations_are_suppressed() {
        let source = "[really weak](https://example.invalid/really)";
        let masked = mask_non_prose(source);

        assert!(masked.contains("really weak"));
        assert_masked(source, "https://example.invalid/really");
    }

    #[test]
    fn nested_and_reference_link_destinations_are_suppressed() {
        let inline = "[really weak](https://example.invalid/a_(nested))";
        let reference = "[really weak][ref]\n\n[ref]: <https://example.invalid/really>\n";

        assert!(mask_non_prose(inline).contains("really weak"));
        assert_masked(inline, "(https://example.invalid/a_(nested))");
        assert!(mask_non_prose(reference).contains("really weak"));
        assert_masked(reference, "<https://example.invalid/really>");
    }

    #[test]
    fn duplicate_reference_definitions_are_all_suppressed() {
        let source = concat!(
            "[label][ref]\n\n",
            "[ref]: https://example.invalid/first\n",
            "[ref]: https://really.example/duplicate\n",
        );

        assert_masked(source, "[ref]: https://example.invalid/first");
        assert_masked(source, "[ref]: https://really.example/duplicate");
    }

    #[test]
    fn quoted_link_titles_do_not_confuse_destination_boundaries() {
        let source = r#"[label](https://really.example "title (")"#;

        assert_masked(source, r#"(https://really.example "title (")"#);
    }

    #[test]
    fn destination_masking_follows_commonmark_admission() {
        let malformed = "Ordinary prose can contain text](really) literally.";
        let autolink = "Visit <https://really.example/weak> for prose.";
        let reference =
            "[really weak][ref]\n\n[ref]: https://example.invalid/really \"really weak title\"\n";

        assert_eq!(mask_non_prose(malformed), malformed);
        assert_masked(autolink, "<https://really.example/weak>");
        assert_masked(
            reference,
            "[ref]: https://example.invalid/really \"really weak title\"",
        );
    }

    #[test]
    fn inline_html_markup_is_suppressed_but_its_text_remains_prose() {
        let source = "Prose <span class=\"really\">really weak</span> prose.";
        let masked = mask_non_prose(source);

        assert_masked(source, "<span class=\"really\">");
        assert_masked(source, "</span>");
        assert!(masked.contains("really weak"));
    }

    #[test]
    fn unterminated_constructs_do_not_hide_the_rest_of_the_document() {
        for source in [
            "Prose `really remains prose.",
            "---\nreally remains prose without a closing delimiter.",
        ] {
            assert_eq!(mask_non_prose(source), source);
        }
    }

    #[test]
    fn masking_preserves_byte_and_utf16_coordinates_after_unicode() {
        let source = "Before `aé漢😀` is really prose.";
        let retained = "is really prose.";
        let retained_start = source.find(retained).expect("retained suffix");
        let masked = mask_non_prose(source);
        let masked_start = masked.find(retained).expect("same retained suffix");

        assert_eq!(masked.len(), source.len());
        assert_eq!(masked_start, retained_start);
        assert_eq!(
            utf16_len(&masked[..masked_start]),
            utf16_len(&source[..retained_start])
        );
        assert_eq!(&masked[masked_start..], retained);
        assert_masked(source, "aé漢😀");
    }

    #[test]
    fn masking_preserves_coordinates_across_scalar_widths_and_line_endings() {
        let source =
            "ASCII `x` alpha.\r\nCombining `a\u{0301}` beta.\rBMP `é漢` gamma.\nAstral `😀` omega.";
        let masked = mask_non_prose(source);

        assert_eq!(masked.len(), source.len());
        assert_eq!(utf16_len(&masked), utf16_len(source));
        assert_eq!(
            masked
                .chars()
                .filter(|character| matches!(character, '\r' | '\n'))
                .collect::<String>(),
            "\r\n\r\n"
        );
        for retained in [" alpha.\r\n", " beta.\r", " gamma.\n", " omega."] {
            let source_start = source.find(retained).expect("retained source suffix");
            let masked_start = masked.find(retained).expect("retained masked suffix");
            assert_eq!(masked_start, source_start);
            assert_eq!(
                utf16_len(&masked[..masked_start]),
                utf16_len(&source[..source_start])
            );
        }
        for excluded in ["x", "a\u{0301}", "é漢", "😀"] {
            assert_masked(source, excluded);
        }
    }

    #[test]
    fn plain_prose_is_borrowed_without_allocation() {
        let source = "This is really plain prose.";
        assert!(matches!(mask_non_prose(source), Cow::Borrowed(candidate) if candidate == source));
    }
}

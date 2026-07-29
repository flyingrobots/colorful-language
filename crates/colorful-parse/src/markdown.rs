//! Markdown-to-prose adaptation without moving source coordinates.

use std::borrow::Cow;
use std::ops::Range;

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// Replace reviewed Markdown non-prose regions with coordinate-equivalent
/// whitespace.
///
/// Text outside those regions is returned byte-for-byte. The returned text has
/// the same byte length, line endings, and UTF-16 length before every retained
/// prose byte, so findings and semantic roles can be projected directly onto
/// the original source.
#[must_use]
pub fn mask_non_prose(source: &str) -> Cow<'_, str> {
    let mut ranges = parser_non_prose_ranges(source);
    ranges.extend(inline_link_destination_ranges(source));
    ranges.extend(reference_destination_ranges(source));
    let ranges = merge_ranges(source, ranges);
    if ranges.is_empty() {
        return Cow::Borrowed(source);
    }

    let mut masked = String::with_capacity(source.len());
    let mut copied_until = 0usize;
    for range in ranges {
        masked.push_str(&source[copied_until..range.start]);
        push_coordinate_whitespace(&mut masked, &source[range.clone()]);
        copied_until = range.end;
    }
    masked.push_str(&source[copied_until..]);
    debug_assert_eq!(masked.len(), source.len());
    debug_assert_eq!(masked.encode_utf16().count(), source.encode_utf16().count());
    Cow::Owned(masked)
}

fn parser_non_prose_ranges(source: &str) -> Vec<Range<usize>> {
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS;
    let parser = Parser::new_ext(source, options).into_offset_iter();
    let mut ranges = Vec::new();
    let mut code_block_start = None;
    let mut metadata_block_start = None;

    for (event, range) in parser {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_block_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    ranges.push(start..range.end);
                }
            }
            Event::Start(Tag::MetadataBlock(_)) => metadata_block_start = Some(range.start),
            Event::End(TagEnd::MetadataBlock(_)) => {
                if let Some(start) = metadata_block_start.take() {
                    ranges.push(start..range.end);
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => ranges.push(range),
            _ => {}
        }
    }
    ranges
}

fn inline_link_destination_ranges(source: &str) -> Vec<Range<usize>> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut cursor = 0usize;

    while cursor + 1 < bytes.len() {
        if bytes[cursor] != b']' || bytes[cursor + 1] != b'(' {
            cursor += 1;
            continue;
        }
        let start = cursor + 1;
        let mut depth = 0usize;
        let mut end = None;
        let mut candidate = start;
        while candidate < bytes.len() {
            match bytes[candidate] {
                b'\\' => candidate = candidate.saturating_add(2),
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
            ranges.push(start..end);
            cursor = end;
        } else {
            cursor += 2;
        }
    }
    ranges
}

fn reference_destination_ranges(source: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut line_start = 0usize;

    for line in source.split_inclusive(['\n', '\r']) {
        let content_end = line.trim_end_matches(['\n', '\r']).len();
        let content = &line[..content_end];
        let indent = content.bytes().take_while(|byte| *byte == b' ').count();
        if indent <= 3 {
            if let Some(label_end) = content[indent..].find("]:") {
                if content.as_bytes().get(indent) == Some(&b'[') {
                    let mut destination_start = indent + label_end + 2;
                    while content
                        .as_bytes()
                        .get(destination_start)
                        .is_some_and(u8::is_ascii_whitespace)
                    {
                        destination_start += 1;
                    }
                    if destination_start < content.len() {
                        let destination_end = reference_destination_end(content, destination_start);
                        if destination_end > destination_start {
                            ranges
                                .push(line_start + destination_start..line_start + destination_end);
                        }
                    }
                }
            }
        }
        line_start += line.len();
    }
    ranges
}

fn reference_destination_end(line: &str, start: usize) -> usize {
    let bytes = line.as_bytes();
    if bytes.get(start) == Some(&b'<') {
        return line[start + 1..]
            .find('>')
            .map_or(line.len(), |end| start + end + 2);
    }

    let mut cursor = start;
    while let Some(byte) = bytes.get(cursor) {
        if byte.is_ascii_whitespace() {
            break;
        }
        if *byte == b'\\' {
            cursor = cursor.saturating_add(2);
        } else {
            cursor += 1;
        }
    }
    cursor.min(line.len())
}

fn merge_ranges(source: &str, mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.retain(|range| {
        range.start < range.end
            && range.end <= source.len()
            && source.is_char_boundary(range.start)
            && source.is_char_boundary(range.end)
    });
    ranges.sort_unstable_by_key(|range| (range.start, range.end));

    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut() {
            if range.start <= previous.end {
                previous.end = previous.end.max(range.end);
                continue;
            }
        }
        merged.push(range);
    }
    merged
}

fn push_coordinate_whitespace(output: &mut String, source: &str) {
    for character in source.chars() {
        match character {
            '\n' | '\r' => output.push(character),
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
        assert!(
            masked[start..end].chars().all(char::is_whitespace),
            "{needle:?} remained analyzable in {masked:?}"
        );
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
    fn plain_prose_is_borrowed_without_allocation() {
        let source = "This is really plain prose.";
        assert!(matches!(mask_non_prose(source), Cow::Borrowed(candidate) if candidate == source));
    }
}

//! Markdown-to-prose adaptation without moving source coordinates.

use std::borrow::Cow;
use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag, TagEnd};

#[derive(Debug, Default)]
struct MarkdownRanges {
    excluded: Vec<Range<usize>>,
    inline_links: Vec<Range<usize>>,
}

/// Replace reviewed Markdown non-prose regions with coordinate-equivalent
/// whitespace.
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
/// assert!(masked["Prose.\n\n".len()..].chars().all(char::is_whitespace));
/// assert_eq!(masked.len(), source.len());
/// assert_eq!(masked.encode_utf16().count(), source.encode_utf16().count());
/// ```
#[must_use]
pub fn mask_non_prose(source: &str) -> Cow<'_, str> {
    let mut ranges = parser_ranges(source);
    for link in ranges.inline_links {
        if let Some(destination) = inline_link_destination_range(source, link) {
            ranges.excluded.push(destination);
        }
    }
    let ranges = merge_ranges(source, ranges.excluded);
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

fn parser_ranges(source: &str) -> MarkdownRanges {
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS;
    let parser = Parser::new_ext(source, options);
    let mut ranges = MarkdownRanges {
        excluded: parser
            .reference_definitions()
            .iter()
            .map(|(_, definition)| definition.span.clone())
            .collect(),
        inline_links: Vec::new(),
    };
    let mut code_block_start = None;
    let mut metadata_block_start = None;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_block_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    ranges.excluded.push(start..range.end);
                }
            }
            Event::Start(Tag::MetadataBlock(_)) => metadata_block_start = Some(range.start),
            Event::End(TagEnd::MetadataBlock(_)) => {
                if let Some(start) = metadata_block_start.take() {
                    ranges.excluded.push(start..range.end);
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
            }) => ranges.excluded.push(range),
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => {
                ranges.excluded.push(range);
            }
            _ => {}
        }
    }
    ranges
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
        while candidate < link.end {
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

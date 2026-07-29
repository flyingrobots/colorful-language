//! Markdown-to-prose adaptation without moving source coordinates.

use std::borrow::Cow;

/// Replace reviewed Markdown non-prose regions with coordinate-equivalent
/// whitespace.
///
/// Text outside those regions is returned byte-for-byte. The returned text has
/// the same byte length, line endings, and UTF-16 length before every retained
/// prose byte, so findings and semantic roles can be projected directly onto
/// the original source.
#[must_use]
pub fn mask_non_prose(source: &str) -> Cow<'_, str> {
    Cow::Borrowed(source)
}

#[cfg(test)]
mod tests {
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
}

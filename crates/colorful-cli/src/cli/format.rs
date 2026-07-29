use std::borrow::Cow;
use std::path::Path;

use colorful_parse::markdown::mask_non_prose;

pub(super) fn analysis_source_for<'a>(name: Option<&str>, source: &'a str) -> Cow<'a, str> {
    if name.is_some_and(is_markdown_path) {
        mask_non_prose(source)
    } else {
        Cow::Borrowed(source)
    }
}

fn is_markdown_path(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

use colorful_core::{Analyzer, Finding, Rule, Severity, Span, Token, Tree};

#[derive(Clone)]
pub struct FixedFinding {
    span: Span,
}

impl FixedFinding {
    pub fn new(span: Span) -> Self {
        Self { span }
    }
}

impl Analyzer for FixedFinding {
    fn analyze(&self, _source: &str, _tree: &Tree, _tokens: &[Token]) -> Vec<Finding> {
        vec![Finding {
            span: self.span,
            rule: Rule::WeakWord,
            severity: Severity::Info,
            message: "property finding".to_string(),
        }]
    }
}

pub fn oracle_position(source: &str, byte: usize) -> (usize, usize, u32) {
    let mut line = 0usize;
    let mut scalar_column = 0usize;
    let mut utf16_column = 0u32;
    let mut previous_was_cr = false;
    for (index, character) in source.char_indices() {
        if index >= byte {
            break;
        }
        if previous_was_cr && character == '\n' {
            previous_was_cr = false;
            continue;
        }
        previous_was_cr = false;
        match character {
            '\n' => {
                line += 1;
                scalar_column = 0;
                utf16_column = 0;
            }
            '\r' => {
                line += 1;
                scalar_column = 0;
                utf16_column = 0;
                previous_was_cr = true;
            }
            _ => {
                scalar_column += 1;
                utf16_column += character.len_utf16() as u32;
            }
        }
    }
    (line, scalar_column, utf16_column)
}

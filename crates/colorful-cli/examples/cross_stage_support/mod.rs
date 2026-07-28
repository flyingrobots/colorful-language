use std::hint::black_box;

use colorful_core::{Analyzer, Annotator, Parser, Token, Tree, ValidatedClassification};
use colorful_ir::syntax_v1::DocumentAnalysis;
use colorful_lexicon::ContextualOpenClassAnnotator;
use colorful_lint::ProseLinter;
use colorful_parse::ProseParser;

const SMALL: &str = include_str!("../../fixtures/editor-smoke-prose.txt");
const MEDIUM: &str = include_str!("../../fixtures/bench-corpus.txt");

pub const CORPORA: [Corpus; 2] = [
    Corpus {
        id: "small",
        path: "crates/colorful-cli/fixtures/editor-smoke-prose.txt",
        source: SMALL,
    },
    Corpus {
        id: "medium",
        path: "crates/colorful-cli/fixtures/bench-corpus.txt",
        source: MEDIUM,
    },
];

pub const STAGES: [Stage; 7] = [
    Stage::Parsing,
    Stage::Annotation,
    Stage::ClassificationValidation,
    Stage::Lint,
    Stage::IrProjection,
    Stage::IrSerialization,
    Stage::IrValidation,
];

pub struct Corpus {
    pub id: &'static str,
    pub path: &'static str,
    pub source: &'static str,
}

#[derive(Clone, Copy)]
pub enum Stage {
    Parsing,
    Annotation,
    ClassificationValidation,
    Lint,
    IrProjection,
    IrSerialization,
    IrValidation,
}

impl Stage {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Parsing => "parsing",
            Self::Annotation => "annotation",
            Self::ClassificationValidation => "classification-validation",
            Self::Lint => "lint",
            Self::IrProjection => "ir-projection",
            Self::IrSerialization => "ir-serialization",
            Self::IrValidation => "ir-validation",
        }
    }
}

pub struct PreparedStageInput {
    corpus: &'static Corpus,
    parser: ProseParser,
    annotator: ContextualOpenClassAnnotator,
    linter: ProseLinter,
    tree: Tree,
    tokens: Vec<Token>,
    classification: ValidatedClassification<'static>,
    document: DocumentAnalysis,
}

impl PreparedStageInput {
    pub fn new(corpus: &'static Corpus) -> Self {
        let parser = ProseParser::new();
        let annotator = ContextualOpenClassAnnotator::default();
        let linter = ProseLinter::new();
        let tree = parser.parse(corpus.source);
        let tokens = annotator.annotate(corpus.source, &tree);
        let classification =
            ValidatedClassification::new(corpus.source, tree.clone(), tokens.clone())
                .expect("built-in adapters produce a valid classification");
        let document = colorful_ir::from_validated_classification(
            corpus.id,
            &classification,
            parser.pass_identity(),
            annotator.pass_identity(),
        )
        .expect("built-in adapters project valid IR");
        Self {
            corpus,
            parser,
            annotator,
            linter,
            tree,
            tokens,
            classification,
            document,
        }
    }

    pub fn run(&self, stage: Stage) {
        match stage {
            Stage::Parsing => {
                drop(black_box(self.parser.parse(black_box(self.corpus.source))));
            }
            Stage::Annotation => {
                drop(black_box(self.annotator.annotate(
                    black_box(self.corpus.source),
                    black_box(&self.tree),
                )));
            }
            Stage::ClassificationValidation => {
                black_box(colorful_core::validate_classification(
                    black_box(self.corpus.source),
                    black_box(&self.tree),
                    black_box(&self.tokens),
                ))
                .expect("built-in classification validates");
            }
            Stage::Lint => {
                drop(black_box(self.linter.analyze(
                    black_box(self.corpus.source),
                    black_box(&self.tree),
                    black_box(&self.tokens),
                )));
            }
            Stage::IrProjection => {
                drop(black_box(
                    colorful_ir::from_validated_classification(
                        self.corpus.id,
                        black_box(&self.classification),
                        self.parser.pass_identity(),
                        self.annotator.pass_identity(),
                    )
                    .expect("validated classification projects"),
                ));
            }
            Stage::IrSerialization => {
                drop(black_box(
                    colorful_ir::canonical_json(black_box(&self.document))
                        .expect("serialize canonical IR"),
                ));
            }
            Stage::IrValidation => {
                colorful_ir::validate_document(
                    black_box(&self.document),
                    Some(black_box(self.corpus.source.as_bytes())),
                )
                .expect("validate projected IR");
            }
        }
    }
}

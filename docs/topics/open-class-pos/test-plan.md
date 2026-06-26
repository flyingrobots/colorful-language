# Open-class POS — Test Plan

Requirements:

- **POS-1** The core domain model represents open-class noun, verb, adjective,
  and adverb tags explicitly, without replacing closed-class `FunctionKind`s.
- **POS-2** The `Annotator` port can emit open-class tags using context from a
  parsed `Tree`, without requiring parser changes or editor-specific types.
- **POS-3** The closed-class adapter remains stable: unknown content words still
  classify as `Content`, and structural/closed-class behavior does not change.
- **POS-4** A deterministic seed lexicon can tag representative unambiguous
  open-class words as noun, verb, adjective, and adverb while preserving
  function-word and number precedence.
- **POS-5** The `colorful.syntax/v1` IR boundary carries open-class noun, verb,
  adjective, and adverb decisions as an explicit optional axis on `WORD` /
  `CONTENT` tokens.
- **POS-6** The vocabulary manifest maps explicit open-class axes to distinct
  presentation roles without changing closed-class adapter behavior.
- **POS-7** The shipped default CLI, IR, and LSP surfaces use the deterministic
  seed open-class lexicon while preserving closed-class and number precedence.

## Cases

- **POS-1a** — *Requirement:* POS-1. *Behavior:* the core exposes noun, verb,
  adjective, and adverb as first-class open-class POS values. *Oracle:* equality
  of `OpenClassKind` values carried by `PosClass::Open`. *Evidence:*
  `colorful-core` `tests::open_class_pos_contract_is_representable_by_annotator_port`.
  *Status:* implemented.
- **POS-2a** — *Requirement:* POS-2. *Behavior:* a custom annotator emits
  open-class tags from a parsed `Tree` without using a `Lexicon`. *Oracle:* class
  vector equality. *Evidence:* `colorful-core`
  `tests::open_class_pos_contract_is_representable_by_annotator_port`.
  *Status:* implemented.
- **POS-3a** — *Requirement:* POS-3. *Behavior:* `ClosedClassLexicon` keeps
  unknown content words undifferentiated. *Oracle:* equality of `PosClass`.
  *Evidence:* `colorful-lexicon` `tests::content_words_are_undifferentiated`.
  *Status:* implemented.
- **POS-4a** — *Requirement:* POS-4. *Behavior:* the seed lexicon tags
  representative noun, verb, adjective, and adverb words. *Oracle:* equality of
  `PosClass::Open` values. *Evidence:* `colorful-lexicon`
  `tests::seed_open_class_lexicon_tags_representative_content_words`.
  *Status:* implemented.
- **POS-4b** — *Requirement:* POS-4. *Behavior:* the seed lexicon preserves
  closed-class and number precedence. *Oracle:* equality of `PosClass`.
  *Evidence:* `colorful-lexicon`
  `tests::seed_open_class_lexicon_preserves_closed_class_and_number_precedence`.
  *Status:* implemented.
- **POS-5a** — *Requirement:* POS-5. *Behavior:* `colorful.syntax/v1` projects
  `PosClass::Open(Noun|Verb|Adjective|Adverb)` as `WORD` / `CONTENT` plus the
  matching `openClassKind`. *Oracle:* token-axis equality. *Evidence:*
  `colorful-ir`
  `integration::open_class_pos_projects_with_explicit_open_class_kind`. *Status:*
  implemented.
- **POS-5b** — *Requirement:* POS-5. *Behavior:* IR validation rejects
  `openClassKind` on function words, proper-noun candidates, and non-word tokens.
  *Oracle:* `ValidationError::IllegalTokenAxes`. *Evidence:* `colorful-ir`
  `integration::rejects_illegal_token_axes`. *Status:* implemented.
- **POS-6a** — *Requirement:* POS-6. *Behavior:* open-class noun, verb,
  adjective, and adverb classes map to distinct `VisualRole` values and
  per-surface projections. *Oracle:* manifest table equality. *Evidence:*
  `colorful-ir` `vocabulary::tests::pos_classes_map_to_the_expected_roles`.
  *Status:* implemented.
- **POS-7a** — *Requirement:* POS-7. *Behavior:* the default CLI colorizer emits
  the manifest ANSI projections for seeded noun, verb, adjective, and adverb
  words. *Oracle:* exact ANSI string equality. *Evidence:* `colorful-cli`
  `tests::default_colorizer_emits_seed_open_class_roles`. *Status:* implemented.
- **POS-7b** — *Requirement:* POS-7. *Behavior:* `colorful ir` emits
  `openClassKind` for seeded noun, verb, adjective, and adverb words on the
  default path. *Oracle:* JSON token-axis equality. *Evidence:* `colorful-cli`
  `tests::ir_uses_default_seed_open_class_roles`. *Status:* implemented.
- **POS-7c** — *Requirement:* POS-7. *Behavior:* the default LSP semantic-token
  path emits noun, verb, adjective, and adverb token types for seeded words.
  *Oracle:* `SemanticToken` vector equality. *Evidence:* `colorful-lsp`
  `tests::default_semantic_tokens_emit_seed_open_class_roles`. *Status:*
  implemented.

## Known gaps

- Context disambiguation for ambiguous words such as `book`, `record`, and
  `lead` is not implemented yet. The seed adapter intentionally covers only a
  small set of representative unambiguous words.
- Unlisted ordinary content words remain undifferentiated `Content` until a
  richer lexicon or contextual annotator exists.

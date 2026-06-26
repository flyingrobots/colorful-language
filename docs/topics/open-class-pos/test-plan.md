# Open-class POS — Test Plan

Requirements:

- **POS-1** The core domain model represents open-class noun, verb, adjective,
  and adverb tags explicitly, without replacing closed-class `FunctionKind`s.
- **POS-2** The `Annotator` port can emit open-class tags using context from a
  parsed `Tree`, without requiring parser changes or editor-specific types.
- **POS-3** The default closed-class path remains stable: unknown content words
  still classify as `Content`, and structural/closed-class behavior does not
  change.
- **POS-4** An opt-in deterministic seed lexicon can tag representative
  unambiguous open-class words as noun, verb, adjective, and adverb while
  preserving function-word and number precedence.
- **POS-5** The `colorful.syntax/v1` IR boundary remains honest: until the IR
  contract grows explicit open-class axes, open-class domain tags project as
  `CONTENT` rather than inventing unsupported wire values.

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
- **POS-4a** — *Requirement:* POS-4. *Behavior:* the opt-in seed lexicon tags
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
  open-class domain tags as `WORD` / `CONTENT` until the IR contract grows
  explicit open-class axes. *Oracle:* token-axis equality. *Evidence:*
  `colorful-ir` `integration::open_class_pos_projects_as_content_in_syntax_v1`.
  *Status:* implemented.

## Known gaps

- Context disambiguation for ambiguous words such as `book`, `record`, and
  `lead` is not implemented yet. This first slice establishes the domain
  contract and a deterministic seed adapter only.
- The IR and vocabulary contracts do not yet expose distinct noun, verb,
  adjective, or adverb axes. A later Goalpost 2 slice must expand the
  `colorful.syntax` / `colorful.vocabulary` contracts and regenerate boundary
  DTOs before downstream consumers can receive distinct open-class tags.

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
- **POS-8** The shipped default annotator uses local sentence context to
  disambiguate a small ambiguous open-class set without changing parser, IR, or
  editor contracts.
- **POS-9** Packaged editors must prove clean-install live POS visualization for
  Plain Text and Markdown with explicit theme and fallback evidence.
- **POS-10** Independent behavioral research must test live POS visualization
  as a separate user proposition before the roadmap treats it as validated.

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
- **POS-8a** — *Requirement:* POS-8. *Behavior:* context disambiguates the
  supported ambiguous set: `book` and `record` as noun/verb, `lead` as
  noun/verb/adjective, and `fast` as adjective/adverb. *Oracle:* class vector
  equality. *Evidence:* `colorful-lexicon`
  `tests::contextual_annotator_disambiguates_ambiguous_open_class_words`,
  `tests::contextual_annotator_covers_record_and_lead_roles`.
  *Status:* implemented.
- **POS-8b** — *Requirement:* POS-8. *Behavior:* contextual disambiguation keeps
  function-word, number, seed-open-class, punctuation, and unlisted-content
  behavior stable. *Oracle:* class vector equality. *Evidence:*
  `colorful-lexicon`
  `tests::contextual_annotator_preserves_existing_precedence`. *Status:*
  implemented.
- **POS-9a** — *Requirement:* POS-9. *Behavior:* clean installed VS Code/Open
  VSX and Zed artifacts expose noun, verb, adjective, and adverb roles in Plain
  Text and Markdown under a reviewed theme and documented fallback. *Oracle:*
  exact semantic-token roles plus reviewed screenshot/text-equivalent equality
  after clean activation. *Evidence type:* packaged editor smoke tests and
  accessible visual evidence. *Tracking:*
  [#136](https://github.com/flyingrobots/colorful-language/issues/136) and
  [#154](https://github.com/flyingrobots/colorful-language/issues/154).
  *Status:* planned.
- **POS-10a** — *Requirement:* POS-10. *Behavior:* the discovery study measures
  task completion, repeat use, false-positive tolerance, install willingness,
  and willingness to pay for live POS visualization independently from CI
  linting and portable IR. *Oracle:* preregistered protocol, participant-group
  quotas, captured observations, and an explicit continue/narrow/pause decision.
  *Evidence type:* blinded research packet and study report. *Tracking:*
  [#158](https://github.com/flyingrobots/colorful-language/issues/158).
  *Status:* planned.

## Known gaps

- Context disambiguation is deliberately local and deterministic. It is not a
  production grammar, and it does not attempt probabilistic whole-sentence
  tagging.
- Unlisted ordinary content words remain undifferentiated `Content` until a
  richer lexicon or broader contextual annotator covers them.
- Packaged editor/theme evidence remains open in POS-9a.
- Independent behavioral validation remains open in POS-10a; deterministic
  classification fixtures alone do not validate the user proposition.

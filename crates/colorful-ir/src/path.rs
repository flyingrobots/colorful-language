/// One segment of a [`Path`]: a named field, or an index into a list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathSegment {
    /// A field access, e.g. `.byteRange`.
    Field(&'static str),
    /// A list index, e.g. `[3]`.
    Index(usize),
}

/// A field path into a [`crate::syntax_v1::DocumentAnalysis`], identifying
/// exactly where a [`crate::ValidationError`] found a broken invariant — e.g.
/// `tokens[3].byteRange.startUtf8` — so a consumer can locate the failure by
/// following field names, not by parsing prose. Field names match the wire
/// (camelCase) names, since a `Path` is meant to be read against the JSON a
/// consumer actually received.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Path(Vec<PathSegment>);

impl Path {
    /// The empty path — the document itself.
    #[must_use]
    pub fn root() -> Self {
        Self(Vec::new())
    }

    /// Append a field access.
    #[must_use]
    pub fn field(mut self, name: &'static str) -> Self {
        self.0.push(PathSegment::Field(name));
        self
    }

    /// Append a list index.
    #[must_use]
    pub fn index(mut self, i: usize) -> Self {
        self.0.push(PathSegment::Index(i));
        self
    }

    /// The path's segments, in order from the root.
    #[must_use]
    pub fn segments(&self) -> &[PathSegment] {
        &self.0
    }
}

impl core::fmt::Display for Path {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for (i, segment) in self.0.iter().enumerate() {
            match segment {
                PathSegment::Field(name) => {
                    if i > 0 {
                        write!(f, ".")?;
                    }
                    write!(f, "{name}")?;
                }
                PathSegment::Index(index) => write!(f, "[{index}]")?,
            }
        }
        Ok(())
    }
}

#![warn(clippy::cognitive_complexity)]

/// Deliberately exceeds the repository's cognitive-complexity budget.
pub fn within_budget(value: u16) -> u16 {
    let mut score = 0;
    if value & (1 << 0) != 0 {
        score += 1;
    }
    if value & (1 << 1) != 0 {
        score += 1;
    }
    if value & (1 << 2) != 0 {
        score += 1;
    }
    if value & (1 << 3) != 0 {
        score += 1;
    }
    if value & (1 << 4) != 0 {
        score += 1;
    }
    if value & (1 << 5) != 0 {
        score += 1;
    }
    if value & (1 << 6) != 0 {
        score += 1;
    }
    if value & (1 << 7) != 0 {
        score += 1;
    }
    if value & (1 << 8) != 0 {
        score += 1;
    }
    if value & (1 << 9) != 0 {
        score += 1;
    }
    if value & (1 << 10) != 0 {
        score += 1;
    }
    score
}

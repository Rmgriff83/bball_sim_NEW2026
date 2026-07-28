<?php

namespace App\Support;

/**
 * Lightweight server-side profanity screen for community roster builds
 * (titles, descriptions, player/coach names). Deliberately conservative:
 * exact-token and substring checks against a compact slur/profanity list —
 * the goal is keeping obviously offensive content off the shared board, not
 * perfect filtering (the report/takedown flow catches the rest).
 */
class ProfanityScreen
{
    /**
     * Substring-matched terms (catch embedded variants). Keep this list to
     * unambiguous terms only — substring matching on short/ambiguous words
     * produces false positives (the classic "Scunthorpe problem").
     */
    private const SUBSTRING_TERMS = [
        'fuck', 'shit', 'cunt', 'nigg', 'faggot', 'kike', 'wetback',
        'chink', 'beaner', 'tranny', 'retard', 'rape', 'nazi', 'hitler',
        'porn', 'penis', 'vagina', 'whore', 'slut',
    ];

    /**
     * Exact-token matches (word-boundary). Short/ambiguous terms live here,
     * NOT in the substring list — the old space-suffixed substring trick
     * ('dick ') still matched the END of legitimate surnames ("Redick",
     * "Riddick") whenever another word followed.
     */
    private const TOKEN_TERMS = [
        'ass', 'tits', 'cum', 'fag', 'coon', 'gook', 'homo',
        'dick', 'cock', 'spic',
    ];

    /**
     * @return string|null The offending fragment when found, else null.
     */
    public static function firstViolation(?string $text): ?string
    {
        if (!$text) {
            return null;
        }
        $lower = mb_strtolower($text);

        foreach (self::SUBSTRING_TERMS as $term) {
            if (str_contains($lower, $term)) {
                return trim($term);
            }
        }

        $tokens = preg_split('/[^a-z0-9]+/', $lower, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($tokens as $token) {
            if (in_array($token, self::TOKEN_TERMS, true)) {
                return $token;
            }
        }

        return null;
    }

    public static function isClean(?string $text): bool
    {
        return self::firstViolation($text) === null;
    }
}

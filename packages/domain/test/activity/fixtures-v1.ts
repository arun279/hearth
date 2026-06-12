/**
 * Permanent v:1 envelope regression fixtures. **Do not modify.**
 *
 * Each fixture below is a snapshot of a valid `v: 1` envelope shape — the
 * exact JSON the activity composer would persist on M8 ship day. When a
 * future migration bumps any envelope to `v: 2`, the corresponding shim
 * is exercised against these fixtures as a back-compat regression: the
 * shim must accept these v:1 inputs unchanged.
 *
 * Adding a NEW fixture is fine. Editing an EXISTING fixture is a
 * contract break — the regression test will fail intentionally to flag
 * the change.
 */

export const PARTS_FIXTURE_V1 = {
  v: 1 as const,
  data: [
    {
      kind: "read_library_item" as const,
      id: "p_read_001",
      libraryItemId: "li_001",
      pinnedRevisionId: "rev_002",
      title: "Chapter 1",
    },
    {
      kind: "listen_audio" as const,
      id: "p_listen_001",
      libraryItemId: "li_audio_001",
      startSeconds: 12,
      endSeconds: 240,
      title: "Dialogue 1",
    },
    {
      kind: "watch_video" as const,
      id: "p_video_001",
      libraryItemId: "li_video_001",
      pinnedRevisionId: "rev_video_001",
      startSeconds: 0,
      title: "Demo",
    },
    {
      kind: "write_reflection" as const,
      id: "p_reflect_001",
      prompt: "What did you notice about the rolling R technique?",
      minWords: 20,
      placeholder: "Two sentences is enough.",
    },
    {
      kind: "quiz" as const,
      id: "p_quiz_001",
      questions: [
        {
          id: "q1",
          prompt: "How many vowels are in Spanish?",
          shape: { kind: "multiple_choice" as const, options: ["3", "5", "7"], answerKeyIndex: 1 },
          explainAfterAnswer: "Spanish has 5 vowels: a, e, i, o, u.",
        },
        {
          id: "q2",
          prompt: "Translate: 'how are you'",
          shape: {
            kind: "short_answer" as const,
            correctAnswer: "cómo estás",
            alsoAccept: ["como estas"],
            exactMatch: false,
          },
        },
      ],
    },
    {
      kind: "attend_session" as const,
      id: "p_session_001",
      studySessionId: "s_001",
    },
    {
      kind: "embed" as const,
      id: "p_embed_001",
      provider: "youtube" as const,
      url: "https://www.youtube.com/embed/abc123",
      title: "Mexican accent demo",
      startSeconds: 30,
    },
  ],
};

export const FLOW_FIXTURE_V1 = {
  v: 1 as const,
  data: {
    prereqs: [
      { fromPartId: "p_read_001", toPartId: "p_quiz_001", kind: "hard" as const },
      { fromPartId: "p_listen_001", toPartId: "p_reflect_001", kind: "soft" as const },
    ],
    displayOrder: [
      "p_read_001",
      "p_listen_001",
      "p_video_001",
      "p_reflect_001",
      "p_quiz_001",
      "p_session_001",
      "p_embed_001",
    ],
  },
};

export const AUDIENCE_FIXTURE_EVERYONE_V1 = {
  v: 1 as const,
  data: { kind: "everyone_enrolled" as const },
};

export const AUDIENCE_FIXTURE_SUBSET_V1 = {
  v: 1 as const,
  data: { kind: "subset" as const, userIds: ["u_001", "u_002", "u_003"] },
};

export const WINDOW_FIXTURE_V1 = {
  v: 1 as const,
  data: {
    opensAt: 1_745_452_800_000,
    dueAt: 1_745_625_600_000,
    closesAt: 1_745_798_400_000,
  },
};

export const POST_CLOSE_FIXTURE_V1 = {
  v: 1 as const,
  data: { kind: "visible_locked" as const },
};

export const COMPLETION_RULE_FIXTURE_MANUAL_V1 = {
  v: 1 as const,
  data: { kind: "manual_mark" as const },
};

export const COMPLETION_RULE_FIXTURE_ALL_PARTS_V1 = {
  v: 1 as const,
  data: { kind: "all_parts_complete" as const },
};

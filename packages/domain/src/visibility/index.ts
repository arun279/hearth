export type VisibilityAudience = "just_me" | "facilitators_only" | "track" | "group";

export type VisibilityScope = {
  readonly audience: VisibilityAudience;
  readonly level: "summary" | "detail";
};

export function defaultVisibilityScope(): VisibilityScope {
  return { audience: "track", level: "detail" };
}

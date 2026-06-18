import { strict as assert } from "node:assert";
import test from "node:test";
import { classifyTodo, parseMilestone } from "./todo-scope.mjs";

test("classifyTodo accepts single-milestone scopes, including m10.5", () => {
  assert.equal(classifyTodo(" * TODO(m11): refresh the helper copy"), "valid");
  assert.equal(classifyTodo("// TODO(m10.5): jsdom component layer"), "valid");
  assert.equal(classifyTodo(" * TODO(m18) marker for deletion"), "valid");
});

test("classifyTodo rejects non-milestone scopes, ranges, and bare TODO", () => {
  assert.equal(classifyTodo(" * TODO(test): add coverage"), "unscoped");
  assert.equal(classifyTodo("  // TODO(scaffolding): remove later"), "unscoped");
  assert.equal(classifyTodo(" * TODO(m11-m12): a range names two milestones"), "unscoped");
  assert.equal(classifyTodo("// TODO bare marker"), "unscoped");
  assert.equal(classifyTodo("TODO: colon form"), "unscoped");
});

test("classifyTodo ignores no-TODO lines and TODO-substring identifiers", () => {
  assert.equal(classifyTodo("const todoList = []"), "none");
  assert.equal(classifyTodo('rule "no-stale-milestone-todo" fires'), "none");
  assert.equal(classifyTodo("the TODONE sentinel value"), "none");
  assert.equal(classifyTodo("just an ordinary line"), "none");
});

test("parseMilestone parses fractional milestones as numbers, never truncated", () => {
  assert.equal(parseMilestone("m10"), 10);
  assert.equal(parseMilestone("m10.5"), 10.5);
  assert.equal(parseMilestone("m20"), 20);
});

test("parseMilestone returns null for non-milestone tokens", () => {
  assert.equal(parseMilestone("test"), null);
  assert.equal(parseMilestone("m11-m12"), null);
  assert.equal(parseMilestone("scaffolding"), null);
});

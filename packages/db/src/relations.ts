/**
 * All drizzle-orm relations live here, imported from every aggregate file.
 * Centralizing prevents TDZ / circular-init errors between mutually-referring
 * tables (drizzle-orm#1308, #4923).
 */
import { relations } from "drizzle-orm";
import { accounts, sessions, users } from "./auth-tables.ts";
import {
  activityLibraryRefs,
  activityPrerequisites,
  activitySuggestedSequences,
  learningActivities,
} from "./schema/activities.ts";
import { groupMemberships, groups } from "./schema/groups.ts";
import { groupInvitations } from "./schema/invitations.ts";
import {
  libraryItems,
  libraryRevisions,
  libraryStewards,
  pendingUploads,
} from "./schema/library.ts";
import { activityRecords, partHistory, partProgress } from "./schema/records.ts";
import {
  sessionAttendance,
  studySessionActivities,
  studySessions,
} from "./schema/study-sessions.ts";
import { pendingContributions, trackEnrollments, tracks } from "./schema/tracks.ts";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  memberships: many(groupMemberships),
  enrollments: many(trackEnrollments),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  memberships: many(groupMemberships),
  tracks: many(tracks),
  libraryItems: many(libraryItems),
  invitations: many(groupInvitations),
}));

export const tracksRelations = relations(tracks, ({ one, many }) => ({
  group: one(groups, { fields: [tracks.groupId], references: [groups.id] }),
  enrollments: many(trackEnrollments),
  activities: many(learningActivities),
  sessions: many(studySessions),
  pendingContributions: many(pendingContributions),
}));

export const libraryItemsRelations = relations(libraryItems, ({ one, many }) => ({
  group: one(groups, { fields: [libraryItems.groupId], references: [groups.id] }),
  revisions: many(libraryRevisions),
  stewards: many(libraryStewards),
  activityRefs: many(activityLibraryRefs),
}));

export const learningActivitiesRelations = relations(learningActivities, ({ one, many }) => ({
  track: one(tracks, { fields: [learningActivities.trackId], references: [tracks.id] }),
  libraryRefs: many(activityLibraryRefs),
  prerequisites: many(activityPrerequisites, { relationName: "activity_prereq_from" }),
  dependents: many(activityPrerequisites, { relationName: "activity_prereq_to" }),
  sequencesFrom: many(activitySuggestedSequences, { relationName: "activity_seq_from" }),
  sequencesTo: many(activitySuggestedSequences, { relationName: "activity_seq_to" }),
  records: many(activityRecords),
}));

// Reciprocal 'one' sides for the named many() relations on learningActivities.
// Drizzle requires both sides when relationName is used (drizzle-orm#1308).
export const activityPrerequisitesRelations = relations(activityPrerequisites, ({ one }) => ({
  gated: one(learningActivities, {
    fields: [activityPrerequisites.activityId],
    references: [learningActivities.id],
    relationName: "activity_prereq_from",
  }),
  prerequisite: one(learningActivities, {
    fields: [activityPrerequisites.prerequisiteActivityId],
    references: [learningActivities.id],
    relationName: "activity_prereq_to",
  }),
}));

export const activitySuggestedSequencesRelations = relations(
  activitySuggestedSequences,
  ({ one }) => ({
    from: one(learningActivities, {
      fields: [activitySuggestedSequences.activityId],
      references: [learningActivities.id],
      relationName: "activity_seq_from",
    }),
    to: one(learningActivities, {
      fields: [activitySuggestedSequences.nextActivityId],
      references: [learningActivities.id],
      relationName: "activity_seq_to",
    }),
  }),
);

export const pendingUploadsRelations = relations(pendingUploads, ({ one }) => ({
  uploader: one(users, {
    fields: [pendingUploads.uploaderUserId],
    references: [users.id],
  }),
  group: one(groups, { fields: [pendingUploads.groupId], references: [groups.id] }),
  libraryItem: one(libraryItems, {
    fields: [pendingUploads.libraryItemId],
    references: [libraryItems.id],
  }),
}));

export const activityRecordsRelations = relations(activityRecords, ({ one, many }) => ({
  activity: one(learningActivities, {
    fields: [activityRecords.activityId],
    references: [learningActivities.id],
  }),
  participant: one(users, {
    fields: [activityRecords.participantId],
    references: [users.id],
  }),
  parts: many(partProgress),
  history: many(partHistory),
}));

export const studySessionsRelations = relations(studySessions, ({ one, many }) => ({
  track: one(tracks, { fields: [studySessions.trackId], references: [tracks.id] }),
  activities: many(studySessionActivities),
  attendance: many(sessionAttendance),
}));

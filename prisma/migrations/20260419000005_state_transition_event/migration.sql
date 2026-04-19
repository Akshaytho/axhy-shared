-- Migration: state_transition_event
-- Adds STATE_TRANSITION to AsnEventType so transitionVisit() from
-- @axhy/shared can write AssignmentEvent rows with a valid eventType.
-- Previously transitionVisit emitted 'STATE_TRANSITION_<state>' as the
-- eventType, which is NOT in the enum — every call silently errored at
-- the Prisma layer. Integration tests surfaced this in real DB writes.
--
-- Going forward: eventType='STATE_TRANSITION' for every machine hop.
-- Specific state info (from, to) lives in the AssignmentEvent.payload.

ALTER TYPE "AsnEventType" ADD VALUE IF NOT EXISTS 'STATE_TRANSITION';

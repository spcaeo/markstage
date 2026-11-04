// The SEO check's "the title is the H1" (src/seo/h1.ts): the built page decides, the canvas only until it is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleIsH1 } from '../src/seo/h1.ts';

test('the layout renders the title as the H1: the built page has it', () => {
  assert.equal(titleIsH1(['Salesforce API Limits: Daily Allocations'], [], 'Salesforce API Limits:  Daily Allocations', false), true);
});

test('a title changed and not saved yet: the layout still has an H1 the text does not account for', () => {
  assert.equal(titleIsH1(['Old title'], [], 'New title', true), true);
  assert.equal(titleIsH1(['A heading in the text'], ['A heading in the text'], 'The title', true), false);
});

test('the built page has no H1: false, whatever the canvas draws', () => {
  assert.equal(titleIsH1([], [], 'The title', true), false);
});

test('before the page is read: the canvas, else unknown (no finding)', () => {
  assert.equal(titleIsH1(null, [], 'The title', true), true);
  assert.equal(titleIsH1(null, [], 'The title', false), null);
});

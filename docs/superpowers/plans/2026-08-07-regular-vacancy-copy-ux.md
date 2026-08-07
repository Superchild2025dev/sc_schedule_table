# Regular Vacancy Copy UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the regular-class vacancy page clearly identify its data as reference-only while simplifying ambiguous headings and removing duplicate guidance.

**Architecture:** Keep the current static HTML, CSS, and Firestore-driven JavaScript behavior unchanged. Add one semantic notice between the filters and schedule, update only approved copy, and protect the result with the existing public-page tests.

**Tech Stack:** HTML5, CSS, Node.js built-in test runner

## Global Constraints

- Do not change availability calculation, Firestore reads, branch/day controls, contact links, or teacher detail behavior.
- Keep the existing registration status labels and colors.
- Display the reference-only guidance exactly once before the schedule.
- Preserve mobile support from 320px upward.

---

### Task 1: Clarify vacancy guidance and headings

**Files:**
- Modify: `tests/public-page-security.test.js`
- Modify: `regular-vacancy-site/index.html`
- Modify: `regular-vacancy-site/styles.css`

**Interfaces:**
- Consumes: Existing `#availability`, `.control-band`, `.schedule-band`, and contact controls.
- Produces: One `.availability-notice` region rendered before `.schedule-band` with no JavaScript dependency.

- [ ] **Step 1: Write the failing copy and placement test**

Add assertions to `tests/public-page-security.test.js`:

```js
assert.match(html, /정규반 자리 안내/);
assert.match(html, /요일별 자리 현황/);
assert.match(html, /정규반 등록 가능 시간을 확인하세요\./);
assert.match(html, /본 페이지의 빈자리 현황은 참고용이며, 등록 및 반 이동 상황에 따라 변동될 수 있습니다\./);
assert.match(html, /정확한 등록 가능 여부는 해당 지점으로 문의해 주세요\./);
assert.equal((html.match(/본 페이지의 빈자리 현황은 참고용이며/g) || []).length, 1);
assert.ok(html.indexOf('class="availability-notice"') < html.indexOf('class="schedule-band"'));
assert.doesNotMatch(html, /2026년 9월 정규반 등록 가능 시간을 확인하세요/);
assert.doesNotMatch(html, /정규반 전환 안내|>등록 가능한 시간</);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test tests/public-page-security.test.js`

Expected: FAIL because the approved copy and `.availability-notice` do not exist yet.

- [ ] **Step 3: Apply the minimal HTML copy and placement changes**

In `regular-vacancy-site/index.html`:

```html
<p class="hero-copy">정규반 등록 가능 시간을 확인하세요.</p>
```

Replace the control heading with:

```html
<p class="eyebrow">정규반 자리 안내</p>
<h2 id="availability-title">요일별 자리 현황</h2>
```

Insert this immediately after `</section>` for `.control-band`:

```html
<section class="availability-notice" aria-label="빈자리 현황 안내">
  <div class="content availability-notice-inner">
    <i data-lucide="info" aria-hidden="true"></i>
    <p>
      <strong>본 페이지의 빈자리 현황은 참고용이며,</strong>
      등록 및 반 이동 상황에 따라 변동될 수 있습니다.
      정확한 등록 가능 여부는 해당 지점으로 문의해 주세요.
    </p>
  </div>
</section>
```

Delete the old `.notice-band` section at the bottom so the notice appears only once.

- [ ] **Step 4: Style the notice as a restrained full-width information band**

In `regular-vacancy-site/styles.css`, replace `.notice-band` and `.notice-inner` rules with:

```css
.availability-notice {
  border-bottom: 1px solid #bfdbfe;
  background: var(--blue-soft);
}

.availability-notice-inner {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  padding-bottom: 12px;
  color: #334155;
}

.availability-notice-inner svg {
  flex: 0 0 auto;
  width: 19px;
  height: 19px;
  color: var(--blue);
}

.availability-notice-inner p {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.65;
}

.availability-notice-inner strong {
  font-weight: 900;
}
```

- [ ] **Step 5: Run focused and regression tests**

Run: `node --test tests/public-page-security.test.js tests/regular-availability.test.js`

Expected: PASS with zero failures.

- [ ] **Step 6: Verify desktop and mobile rendering**

Open `http://127.0.0.1:8000/regular-vacancy-site/?cb=vacancy-copy1` at desktop and 390px mobile widths. Confirm the notice is above the schedule, no text overlaps, branch/day controls work, teacher details expand, and contact links remain visible.

- [ ] **Step 7: Commit**

```bash
git add tests/public-page-security.test.js regular-vacancy-site/index.html regular-vacancy-site/styles.css
git commit -m "Clarify regular vacancy guidance"
```

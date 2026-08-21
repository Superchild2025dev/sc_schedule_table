"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function indexSignature(index) {
  return JSON.stringify({
    collectionGroup:index.collectionGroup,
    queryScope:index.queryScope,
    fields:Array.isArray(index.fields) ? index.fields.map(field => ({
      fieldPath:field.fieldPath,
      order:field.order,
      arrayConfig:field.arrayConfig,
    })) : index.fields,
  });
}

test("request recovery compound queries have exact collection-scope indexes", () => {
  const firebaseConfig = readJson("firebase.json");
  const indexConfig = readJson("firestore.indexes.json");
  const expected = [
    {
      collectionGroup:"requestRecoveries",
      queryScope:"COLLECTION",
      fields:[
        {fieldPath:"state", order:"ASCENDING"},
        {fieldPath:"updatedAt", order:"ASCENDING"},
      ],
    },
    {
      collectionGroup:"requestRecoveries",
      queryScope:"COLLECTION",
      fields:[
        {fieldPath:"state", order:"ASCENDING"},
        {fieldPath:"expiresAt", order:"ASCENDING"},
      ],
    },
  ];

  assert.equal(firebaseConfig.firestore.indexes, "firestore.indexes.json");
  assert.ok(Array.isArray(indexConfig.indexes), "Firestore indexes must be an array");

  const signatures = indexConfig.indexes.map(indexSignature);
  assert.equal(
    new Set(signatures).size,
    signatures.length,
    "Firestore indexes must not contain equivalent duplicate definitions"
  );

  expected.forEach(index => {
    const signature = indexSignature(index);
    assert.equal(
      signatures.filter(candidate => candidate === signature).length,
      1,
      `Missing or duplicated exact Firestore index: ${signature}`
    );
  });
});

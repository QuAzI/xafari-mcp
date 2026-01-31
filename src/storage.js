import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./config.js";

const pagesPath = path.join(dataDir, "pages.json");
const indexPath = path.join(dataDir, "index.json");

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function saveJson(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function savePages(pages) {
  await saveJson(pagesPath, pages);
}

async function loadPages() {
  return loadJson(pagesPath);
}

async function saveIndex(index) {
  await saveJson(indexPath, index);
}

async function loadIndex() {
  return loadJson(indexPath);
}

function getPagesPath() {
  return pagesPath;
}

function getIndexPath() {
  return indexPath;
}

export {
  savePages,
  loadPages,
  saveIndex,
  loadIndex,
  getPagesPath,
  getIndexPath,
};

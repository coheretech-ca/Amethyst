import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("gallery.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    width INTEGER,
    height INTEGER,
    folder_id TEXT,
    access_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS smart_albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    criteria TEXT NOT NULL, -- JSON string of criteria
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (photo_id, tag_id),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
`);

// Add folder_id column if it doesn't exist
try {
  db.exec("ALTER TABLE photos ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL");
} catch (e) {
  // Column likely already exists
}

try {
  db.exec("ALTER TABLE photos ADD COLUMN access_count INTEGER DEFAULT 0");
} catch (e) {
  // Column likely already exists
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/photos", (req, res) => {
    const { folder_id, q } = req.query;
    let query = `
      SELECT DISTINCT p.*, 
      (SELECT COUNT(*) FROM notes n WHERE n.photo_id = p.id AND n.content IS NOT NULL AND n.content != '') as has_note,
      (SELECT COUNT(*) FROM photo_tags pt WHERE pt.photo_id = p.id) as tag_count
      FROM photos p
    `;
    const params = [];
    
    const conditions = [];
    
    if (folder_id) {
      conditions.push("p.folder_id = ?");
      params.push(folder_id);
    } else if (folder_id === "") {
      conditions.push("p.folder_id IS NULL");
    }
    
    if (q) {
      query += " LEFT JOIN notes n ON p.id = n.photo_id";
      query += " LEFT JOIN photo_tags pt ON p.id = pt.photo_id";
      query += " LEFT JOIN tags t ON pt.tag_id = t.id";
      
      conditions.push("(p.filename LIKE ? OR n.content LIKE ? OR t.name LIKE ?)");
      const searchParam = `%${q}%`;
      params.push(searchParam, searchParam, searchParam);
    }
    
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    
    query += " ORDER BY p.created_at DESC";
    const photos = db.prepare(query).all(...params);
    res.json(photos);
  });

  app.get("/api/graph", (req, res) => {
    const photos = db.prepare("SELECT id, filename FROM photos").all();
    const tags = db.prepare("SELECT id, name FROM tags").all();
    const photoTags = db.prepare("SELECT photo_id, tag_id FROM photo_tags").all();
    const notes = db.prepare("SELECT photo_id, content FROM notes").all();
    
    const nodes: any[] = [];
    const links: any[] = [];

    photos.forEach((p: any) => {
      nodes.push({ id: p.id, name: p.filename, type: 'photo', photo: p });
    });

    tags.forEach((t: any) => {
      nodes.push({ id: t.id, name: t.name, type: 'tag' });
    });

    photoTags.forEach((pt: any) => {
      links.push({ source: pt.photo_id, target: pt.tag_id });
    });

    notes.forEach((n: any) => {
      if (!n.content) return;
      const matches = n.content.matchAll(/\[\[(.*?)\]\]/g);
      for (const match of matches) {
        const targetName = match[1];
        const targetPhoto = photos.find((p: any) => p.filename === targetName || p.id === targetName);
        if (targetPhoto) {
          links.push({ source: n.photo_id, target: targetPhoto.id });
        }
      }
    });

    res.json({ nodes, links });
  });

  app.patch("/api/photos/:id", (req, res) => {
    const { width, height, size } = req.body;
    db.prepare("UPDATE photos SET width = ?, height = ?, size = ? WHERE id = ?")
      .run(width, height, size, req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/photos/:id/access", (req, res) => {
    db.prepare("UPDATE photos SET access_count = access_count + 1 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/photos/:id/folder", (req, res) => {
    const { folder_id } = req.body;
    console.log(`Moving photo ${req.params.id} to folder ${folder_id}`);
    db.prepare("UPDATE photos SET folder_id = ? WHERE id = ?").run(folder_id, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/photos/bulk-move", (req, res) => {
    const { ids, folder_id } = req.body;
    console.log(`Bulk moving ${ids.length} photos to folder ${folder_id}`);
    const stmt = db.prepare("UPDATE photos SET folder_id = ? WHERE id = ?");
    const transaction = db.transaction((photoIds, fId) => {
      for (const id of photoIds) stmt.run(fId, id);
    });
    transaction(ids, folder_id);
    res.json({ success: true });
  });

  app.post("/api/photos/bulk-delete", (req, res) => {
    const { ids } = req.body;
    const stmt = db.prepare("DELETE FROM photos WHERE id = ?");
    const transaction = db.transaction((photoIds) => {
      for (const id of photoIds) stmt.run(id);
    });
    transaction(ids);
    res.json({ success: true });
  });

  // Folders
  app.get("/api/folders", (req, res) => {
    const folders = db.prepare("SELECT * FROM folders ORDER BY name ASC").all();
    res.json(folders);
  });

  app.post("/api/folders", (req, res) => {
    const { id, name, parent_id } = req.body;
    db.prepare("INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)")
      .run(id, name, parent_id || null);
    res.json({ success: true });
  });

  app.delete("/api/folders/:id", (req, res) => {
    db.prepare("DELETE FROM folders WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/folders/:id", (req, res) => {
    const { name } = req.body;
    db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, req.params.id);
    res.json({ success: true });
  });

  // Tags
  app.get("/api/tags", (req, res) => {
    const tags = db.prepare("SELECT * FROM tags").all();
    res.json(tags);
  });

  app.get("/api/photos/:id/tags", (req, res) => {
    const tags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN photo_tags pt ON t.id = pt.tag_id
      WHERE pt.photo_id = ?
    `).all(req.params.id);
    res.json(tags);
  });

  app.post("/api/photos/:id/tags", (req, res) => {
    const { name } = req.body;
    let tag = db.prepare("SELECT * FROM tags WHERE name = ?").get(name);
    if (!tag) {
      const tagId = crypto.randomUUID();
      db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tagId, name);
      tag = { id: tagId, name };
    }
    try {
      db.prepare("INSERT INTO photo_tags (photo_id, tag_id) VALUES (?, ?)").run(req.params.id, tag.id);
    } catch (e) {
      // Ignore duplicate tags
    }
    res.json(tag);
  });

  app.post("/api/photos/bulk-tag", (req, res) => {
    const { ids, name } = req.body;
    let tag = db.prepare("SELECT * FROM tags WHERE name = ?").get(name);
    if (!tag) {
      const tagId = crypto.randomUUID();
      db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tagId, name);
      tag = { id: tagId, name };
    }
    const stmt = db.prepare("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)");
    const transaction = db.transaction((photoIds, tagId) => {
      for (const id of photoIds) stmt.run(id, tagId);
    });
    transaction(ids, tag.id);
    res.json({ success: true });
  });

  app.delete("/api/photos/:photoId/tags/:tagId", (req, res) => {
    db.prepare("DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?")
      .run(req.params.photoId, req.params.tagId);
    res.json({ success: true });
  });

  // Smart Albums
  app.get("/api/smart-albums", (req, res) => {
    const albums = db.prepare("SELECT * FROM smart_albums").all();
    res.json(albums.map(a => ({ ...a, criteria: JSON.parse(a.criteria) })));
  });

  app.post("/api/smart-albums", (req, res) => {
    const { id, name, criteria } = req.body;
    db.prepare("INSERT INTO smart_albums (id, name, criteria) VALUES (?, ?, ?)")
      .run(id, name, JSON.stringify(criteria));
    res.json({ success: true });
  });

  app.get("/api/smart-albums/:id/photos", (req, res) => {
    const album = db.prepare("SELECT * FROM smart_albums WHERE id = ?").get(req.params.id);
    if (!album) return res.status(404).json({ error: "Not found" });
    
    const criteria = JSON.parse(album.criteria);
    let query = `
      SELECT DISTINCT p.*,
      (SELECT COUNT(*) FROM notes n WHERE n.photo_id = p.id AND n.content IS NOT NULL AND n.content != '') as has_note,
      (SELECT COUNT(*) FROM photo_tags pt WHERE pt.photo_id = p.id) as tag_count
      FROM photos p
    `;
    const params = [];
    const conditions = [];

    if (criteria.tags && criteria.tags.length > 0) {
      query += " JOIN photo_tags pt ON p.id = pt.photo_id JOIN tags t ON pt.tag_id = t.id";
      conditions.push(`t.name IN (${criteria.tags.map(() => '?').join(',')})`);
      params.push(...criteria.tags);
    }

    if (criteria.startDate) {
      conditions.push("p.created_at >= ?");
      params.push(criteria.startDate);
    }

    if (criteria.endDate) {
      conditions.push("p.created_at <= ?");
      params.push(criteria.endDate);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY p.created_at DESC";
    const photos = db.prepare(query).all(...params);
    res.json(photos);
  });

  app.post("/api/photos", (req, res) => {
    const { id, filename, mime_type, size, width, height, content, folder_id } = req.body;
    
    const insertPhoto = db.prepare(`
      INSERT INTO photos (id, filename, mime_type, size, width, height, folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertNote = db.prepare(`
      INSERT INTO notes (id, photo_id, content)
      VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      insertPhoto.run(id, filename, mime_type, size, width, height, folder_id || null);
      insertNote.run(crypto.randomUUID(), id, content || "");
    });

    transaction();
    res.json({ success: true });
  });

  app.get("/api/photos/:id/note", (req, res) => {
    const note = db.prepare("SELECT * FROM notes WHERE photo_id = ?").get(req.params.id);
    res.json(note || { content: "" });
  });

  app.put("/api/photos/:id/note", (req, res) => {
    const { content } = req.body;
    db.prepare("UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE photo_id = ?")
      .run(content, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/photos/:id", (req, res) => {
    db.prepare("DELETE FROM photos WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

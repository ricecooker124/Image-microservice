import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import morgan from "morgan";
import { createPoolFromEnv } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

const pool = createPoolFromEnv();

const API = "/api/images";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

app.get("/", (_req, res) => res.json({ message: "Image service is running 🚀" }));

app.get("/health", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS ok");
        res.json({ status: "ok", db: rows?.[0]?.ok === 1 });
    } catch (_err) {
        res.status(500).json({ status: "error", message: "DB not reachable" });
    }
});

app.post(API, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const pngBuffer = await sharp(req.file.buffer).png().toBuffer();

        const [result] = await pool.execute(
            `
      INSERT INTO images (content_type, original_name, data, original_image_id)
      VALUES (?, ?, ?, NULL)
      `,
            ["image/png", req.file.originalname || null, pngBuffer]
        );

        const id = result.insertId;

        return res.status(201).json({
            id,
            url: `${API}/${id}/raw`,
        });
    } catch (err) {
        console.error("Upload error:", err);
        return res.status(500).json({ message: "Failed to upload image" });
    }
});

app.get(`${API}/:id/raw`, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid image id" });

        const [rows] = await pool.execute(`SELECT content_type, data FROM images WHERE id = ?`, [id]);

        if (!rows.length) return res.status(404).json({ message: "Image not found" });

        const img = rows[0];
        res.setHeader("Content-Type", img.content_type || "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(img.data);
    } catch (err) {
        console.error("Fetch raw error:", err);
        return res.status(500).json({ message: "Failed to read image" });
    }
});

app.put(`${API}/:id`, upload.single("image"), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid image id" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // Ensure image exists
        const [existing] = await pool.execute(`SELECT id FROM images WHERE id = ?`, [id]);
        if (!existing.length) return res.status(404).json({ message: "Image not found" });

        // Convert to PNG (consistent)
        const pngBuffer = await sharp(req.file.buffer).png().toBuffer();

        await pool.execute(
            `UPDATE images SET content_type = ?, data = ?, original_name = ? WHERE id = ?`,
            ["image/png", pngBuffer, req.file.originalname || "edited.png", id]
        );

        res.setHeader("Cache-Control", "no-store");

        return res.status(200).json({
            id,
            url: `${API}/${id}/raw`,
            updated: true,
        });
    } catch (err) {
        console.error("Replace error:", err);
        return res.status(500).json({ message: "Failed to replace image" });
    }
});

app.post(`${API}/:id/annotate`, async (req, res) => {
    try {
        const originalId = Number(req.params.id);
        if (!Number.isFinite(originalId)) return res.status(400).json({ message: "Invalid image id" });

        const body = req.body || {};
        const strokes = Array.isArray(body.strokes) ? body.strokes : [];
        const texts = Array.isArray(body.texts) ? body.texts : [];

        const [rows] = await pool.execute(
            `SELECT original_name AS originalName, data AS data FROM images WHERE id = ?`,
            [originalId]
        );

        if (!rows.length) return res.status(404).json({ message: "Image not found" });

        const original = rows[0];

        const baseImage = sharp(original.data);
        const meta = await baseImage.metadata();

        const width = meta.width || 1024;
        const height = meta.height || 768;

        const svg = [
            `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
        ];

        for (const stroke of strokes) {
            if (!stroke?.points || stroke.points.length < 2) continue;

            const color = stroke.color || "#ff0000";
            const w = stroke.width || 4;

            const d =
                "M " +
                stroke.points
                    .map((p, i) => (i === 0 ? `${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
                    .join(" ");

            svg.push(
                `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" />`
            );
        }

        for (const t of texts) {
            if (!t?.text) continue;

            const x = t.x ?? 20;
            const y = t.y ?? 20;
            const color = t.color || "#00ff00";
            const fontSize = t.fontSize || 24;

            const escaped = String(t.text).replace(/&/g, "&amp;").replace(/</g, "&lt;");

            svg.push(
                `<text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-family="Arial, sans-serif">${escaped}</text>`
            );
        }

        svg.push("</svg>");
        const svgBuffer = Buffer.from(svg.join(""), "utf-8");

        const annotatedBuffer = await sharp(original.data)
            .composite([{ input: svgBuffer }])
            .png()
            .toBuffer();

        const [insertRes] = await pool.execute(
            `
      INSERT INTO images (content_type, original_name, data, original_image_id)
      VALUES (?, ?, ?, ?)
      `,
            ["image/png", original.originalName || null, annotatedBuffer, originalId]
        );

        const newId = insertRes.insertId;

        return res.status(201).json({
            id: newId,
            url: `${API}/${newId}/raw`,
            originalImageId: originalId,
        });
    } catch (err) {
        console.error("Annotate error:", err);
        return res.status(500).json({ message: "Failed to annotate image" });
    }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`✅ Image service running on port ${PORT}`));
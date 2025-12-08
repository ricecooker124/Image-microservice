import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------- Multer setup ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname) || ".png";
        const safeBase = path
            .basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9-_]/g, "_");

        cb(null, `${timestamp}-${safeBase}${ext}`);
    },
});

const upload = multer({ storage });

// ---------- Health ----------
app.get("/", (req, res) => {
    res.json({ message: "Image service is running 🚀" });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// ---------- Upload ----------
app.post("/images", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const originalPath = req.file.path;
        const pngName = req.file.filename.replace(/\.[^.]+$/, "") + ".png";
        const pngPath = path.join(UPLOAD_DIR, pngName);

        await sharp(originalPath).png().toFile(pngPath);

        if (originalPath !== pngPath && fs.existsSync(originalPath)) {
            fs.unlinkSync(originalPath);
        }

        return res.status(201).json({
            id: pngName,
            url: `/images/${pngName}/raw`,
        });
    } catch (err) {
        console.error("Upload error:", err);
        return res.status(500).json({ message: "Failed to upload image" });
    }
});

// ---------- Get raw image ----------
app.get("/images/:id/raw", async (req, res) => {
    try {
        const { id } = req.params;
        const filePath = path.join(UPLOAD_DIR, id);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Image not found" });
        }

        res.setHeader("Content-Type", "image/png");
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        console.error("Raw error:", err);
        return res.status(500).json({ message: "Failed to read image" });
    }
});

// ---------- Annotate (draw + text) ----------
app.post("/images/:id/annotate", async (req, res) => {
    try {
        const { id } = req.params;
        const {
            strokes = [], // [{ points:[{x,y},...], color, width }]
            texts = [],   // [{ x,y,text,color,fontSize }]
        } = req.body || {};

        const filePath = path.join(UPLOAD_DIR, id);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Image not found" });
        }

        const image = sharp(filePath);
        const meta = await image.metadata();
        const width = meta.width || 1024;
        const height = meta.height || 768;

        const svgParts = [
            `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
        ];

        // Lines
        for (const stroke of strokes) {
            if (!stroke.points || stroke.points.length < 2) continue;
            const color = stroke.color || "#ff0000";
            const w = stroke.width || 4;
            const d =
                "M " +
                stroke.points
                    .map((p, idx) =>
                        idx === 0 ? `${p.x} ${p.y}` : `L ${p.x} ${p.y}`
                    )
                    .join(" ");
            svgParts.push(
                `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" />`
            );
        }

        // Text labels
        for (const t of texts) {
            if (!t.text) continue;
            const x = t.x ?? 20;
            const y = t.y ?? 20;
            const color = t.color || "#00ff00";
            const fontSize = t.fontSize || 24;
            const escaped = String(t.text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
            svgParts.push(
                `<text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-family="Arial, sans-serif">${escaped}</text>`
            );
        }

        svgParts.push("</svg>");
        const svgBuffer = Buffer.from(svgParts.join(""), "utf-8");

        const annotated = await sharp(filePath)
            .composite([{ input: svgBuffer }])
            .png();

        const baseName = path.basename(id, path.extname(id));
        const newId = `${baseName}-annotated.png`;
        const outPath = path.join(UPLOAD_DIR, newId);

        await annotated.toFile(outPath);

        return res.status(201).json({
            id: newId,
            url: `/images/${newId}/raw`,
        });
    } catch (err) {
        console.error("Annotate error:", err);
        return res.status(500).json({ message: "Failed to annotate image" });
    }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
    console.log(`Image service running on port ${PORT}`);
});
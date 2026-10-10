import { Router } from "express";
import { MongoClient } from "mongodb";

const router = Router();

const DASHBOARD_DB = process.env.DASHBOARD_DB || "project_dashboard";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";

async function getDashboardDb() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  return { client, db: client.db(DASHBOARD_DB) };
}

router.get("/", async (_req, res) => {
  const { client, db } = await getDashboardDb();
  try {
    const dashboards = await db.collection("dashboards").find({}).sort({ updated_at: -1 }).toArray();
    res.json(dashboards);
  } finally {
    await client.close();
  }
});

router.get("/:id", async (req, res) => {
  const { client, db } = await getDashboardDb();
  try {
    const dashboard = await db.collection("dashboards").findOne({ id: req.params.id });
    if (!dashboard) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    res.json(dashboard);
  } finally {
    await client.close();
  }
});

export default router;

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { connect } = require('./connection');
const Agent = require('./models/Agent');
const AgentFile = require('./models/AgentFile');
const ToolSchema = require('./models/ToolSchema');
const Interface = require('./models/Interface');
const MultiAgentPattern = require('./models/MultiAgentPattern');
const Orchestrator = require('./models/Orchestrator');
const MemoryAgent = require('./models/MemoryAgent');
const Project = require('./models/Project');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/agents', async (req, res) => {
  const agents = await Agent.find({ type: { $ne: 'orchestrator' } }).sort({ createdAt: 1 });
  res.json(agents);
});

app.post('/api/agents', async (req, res) => {
  try {
    const {
      name, description, model,
      thinkingLevel, sessionMode, workingDir, playground, apiKey, icon, tools,
      toolCallGuardrails,
      compaction,
      systemPrompt, skills
    } = req.body;

    const agent = await Agent.create({
      name, description, model,
      thinkingLevel, sessionMode, workingDir, playground, apiKey, icon, tools,
      toolCallGuardrails,
      ...(compaction ? { compaction } : {}),
    });

    if (systemPrompt) {
      await AgentFile.create({
        agent_id: agent._id,
        type: 'soul',
        content: systemPrompt.content,
      });
    }

    if (skills && skills.length > 0) {
      const combined = skills.map((s) => `### ${s.name}\n\n${s.content}`).join('\n\n---\n\n');
      await AgentFile.create({
        agent_id: agent._id,
        type: 'skills',
        content: combined,
      });
    }

    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/agents/:id/files', async (req, res) => {
  try {
    const files = await AgentFile.find({ agent_id: req.params.id });
    res.json(files);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/agents/:id/sessions', async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.playground) return res.json([]);

    const memoriesDir = path.join(agent.playground, 'memories');
    if (!fs.existsSync(memoriesDir)) return res.json([]);

    const prefix = agent.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_';
    const files = fs.readdirSync(memoriesDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.jsonl'))
      .map(f => {
        const stat = fs.statSync(path.join(memoriesDir, f));
        return {
          filename: f,
          path: path.join(memoriesDir, f),
          size: stat.size,
          modified: stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json(files);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    const {
      name, description, model,
      thinkingLevel, sessionMode, workingDir, playground, apiKey, icon, tools,
      toolCallGuardrails,
      compaction,
      systemPrompt, skills
    } = req.body;

    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { name, description, model, thinkingLevel, sessionMode, workingDir, playground, apiKey, icon, tools, toolCallGuardrails, ...(compaction ? { compaction } : {}) },
      { returnDocument: 'after', runValidators: true }
    );
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (systemPrompt) {
      await AgentFile.findOneAndUpdate(
        { agent_id: agent._id, type: 'soul' },
        { content: systemPrompt.content },
        { upsert: true, new: true }
      );
    } else {
      await AgentFile.deleteOne({ agent_id: agent._id, type: 'soul' });
    }

    if (skills && skills.length > 0) {
      const combined = skills
        .map((s) => s.preloaded ? s.content : `### ${s.name}\n\n${s.content}`)
        .join('\n\n---\n\n');
      await AgentFile.findOneAndUpdate(
        { agent_id: agent._id, type: 'skills' },
        { content: combined },
        { upsert: true, new: true }
      );
    } else {
      await AgentFile.deleteOne({ agent_id: agent._id, type: 'skills' });
    }

    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  try {
    const agent = await Agent.findByIdAndDelete(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    await AgentFile.deleteMany({ agent_id: agent._id });
    res.json({ message: 'Agent deleted successfully', agent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Memory Agent endpoints

app.get('/api/memory-agents', async (req, res) => {
  try {
    const agents = await MemoryAgent.find().sort({ createdAt: 1 });
    res.json(agents);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/memory-agents', async (req, res) => {
  try {
    const {
      name, description, icon, model,
      embedModel, ollamaBaseUrl, collectionName,
      qdrantUrl, qdrantApiKey, customInstructions, apiKey
    } = req.body;

    const agent = await MemoryAgent.create({
      name, description, icon, model,
      embedModel, ollamaBaseUrl, collectionName,
      qdrantUrl, qdrantApiKey, customInstructions, apiKey
    });

    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/memory-agents/:id', async (req, res) => {
  try {
    const {
      name, description, icon, model,
      embedModel, ollamaBaseUrl, collectionName,
      qdrantUrl, qdrantApiKey, customInstructions, apiKey
    } = req.body;

    const agent = await MemoryAgent.findByIdAndUpdate(
      req.params.id,
      {
        name, description, icon, model,
        embedModel, ollamaBaseUrl, collectionName,
        qdrantUrl, qdrantApiKey, customInstructions, apiKey
      },
      { returnDocument: 'after', runValidators: true }
    );
    if (!agent) return res.status(404).json({ error: 'Memory agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/memory-agents/:id', async (req, res) => {
  try {
    const agent = await MemoryAgent.findByIdAndDelete(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Memory agent not found' });
    res.json({ message: 'Memory agent deleted successfully', agent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Tool Schema endpoints
app.get('/api/tools', async (req, res) => {
  try {
    const tools = await ToolSchema.find().sort({ name: 1 });
    res.json(tools);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/tools', async (req, res) => {
  try {
    const { name, description, icon, schema, executionFunction } = req.body;

    if (!name || !description || !schema || !executionFunction) {
      return res.status(400).json({ error: 'name, description, schema, and executionFunction are required' });
    }

    const tool = await ToolSchema.create({ name, description, icon, schema, executionFunction });
    res.status(201).json(tool);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'A tool with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.get('/api/tools/:id', async (req, res) => {
  try {
    const tool = await ToolSchema.findById(req.params.id);
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    res.json(tool);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/tools/:id', async (req, res) => {
  try {
    const { name, description, icon, schema, executionFunction } = req.body;

    const tool = await ToolSchema.findByIdAndUpdate(
      req.params.id,
      { name, description, icon, schema, executionFunction },
      { returnDocument: 'after', runValidators: true }
    );
    
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    
    res.json(tool);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'A tool with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.delete('/api/tools/:id', async (req, res) => {
  try {
    const tool = await ToolSchema.findByIdAndDelete(req.params.id);
    
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    
    res.json({ message: 'Tool deleted successfully', tool });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Interface endpoints ───────────────────────────────────────────────────────

app.get('/api/interfaces', async (req, res) => {
  try {
    const interfaces = await Interface.find().sort({ name: 1 });
    res.json(interfaces);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/interfaces', async (req, res) => {
  try {
    const { name, icon, description } = req.body;

    if (!name || !icon || !description) {
      return res.status(400).json({ error: 'name, icon, and description are required' });
    }

    const iface = await Interface.create({ name, icon, description });
    res.status(201).json(iface);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'An interface with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.get('/api/interfaces/:id', async (req, res) => {
  try {
    const iface = await Interface.findById(req.params.id);
    if (!iface) return res.status(404).json({ error: 'Interface not found' });
    res.json(iface);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/interfaces/:id', async (req, res) => {
  try {
    const { name, icon, description } = req.body;
    const iface = await Interface.findByIdAndUpdate(
      req.params.id,
      { name, icon, description },
      { returnDocument: 'after', runValidators: true }
    );
    if (!iface) return res.status(404).json({ error: 'Interface not found' });
    res.json(iface);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'An interface with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.delete('/api/interfaces/:id', async (req, res) => {
  try {
    const iface = await Interface.findByIdAndDelete(req.params.id);
    if (!iface) return res.status(404).json({ error: 'Interface not found' });
    res.json({ message: 'Interface deleted successfully', interface: iface });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Orchestrator endpoints ───────────────────────────────────────────────────

app.get('/api/orchestrators', async (req, res) => {
  try {
    const agents = await Agent.find({ type: 'orchestrator' }).sort({ createdAt: 1 });
    const result = await Promise.all(
      agents.map(async (agent) => {
        const orch = await Orchestrator.findOne({ orchestrator_id: agent._id }).populate('sub_agents.agent');
        return { ...agent.toObject(), subAgents: orch?.sub_agents ?? [] };
      })
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/orchestrators', async (req, res) => {
  try {
    const { name, description, model, playground, systemPrompt, subAgents } = req.body;

    const agent = await Agent.create({
      name,
      description,
      model,
      type: 'orchestrator',
      playground,
    });

    await Orchestrator.create({
      orchestrator_id: agent._id,
      sub_agents: (subAgents || []).map((s) => ({ agent: s.agentId, stateful: s.stateful ?? false })),
    });

    if (systemPrompt) {
      await AgentFile.create({
        agent_id: agent._id,
        type: 'soul',
        content: systemPrompt,
      });
    }

    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/orchestrators/:id', async (req, res) => {
  try {
    const { name, description, model, playground, systemPrompt, subAgents } = req.body;

    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { name, description, model, playground },
      { returnDocument: 'after', runValidators: true }
    );
    if (!agent) return res.status(404).json({ error: 'Orchestrator not found' });

    if (subAgents) {
      await Orchestrator.findOneAndUpdate(
        { orchestrator_id: agent._id },
        { sub_agents: subAgents.map((s) => ({ agent: s.agentId, stateful: s.stateful ?? false })) },
        { upsert: true, new: true }
      );
    }

    if (systemPrompt) {
      await AgentFile.findOneAndUpdate(
        { agent_id: agent._id, type: 'soul' },
        { content: systemPrompt },
        { upsert: true, new: true }
      );
    } else {
      await AgentFile.deleteOne({ agent_id: agent._id, type: 'soul' });
    }

    res.json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/orchestrators/:id', async (req, res) => {
  try {
    const agent = await Agent.findByIdAndDelete(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Orchestrator not found' });
    await Orchestrator.deleteOne({ orchestrator_id: agent._id });
    await AgentFile.deleteMany({ agent_id: agent._id });
    res.json({ message: 'Orchestrator deleted successfully', agent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Project endpoints ───────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find()
      .populate('repos.agents')
      .populate('repos.orchestrators')
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, description, repos } = req.body;
    if (!name || !description || !repos?.length) {
      return res.status(400).json({ error: 'name, description, and repos are required' });
    }
    const project = await Project.create({ name, description, repos });
    res.status(201).json(project);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'A project with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('repos.agents')
      .populate('repos.orchestrators');
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { name, description, repos } = req.body;
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      { name, description, repos },
      { returnDocument: 'after', runValidators: true }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: 'A project with this name already exists' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project deleted successfully', project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/projects/:id/sessions', async (req, res) => {
  try {
    const { sessionId, filename, filePath } = req.body;
    if (!sessionId || !filename || !filePath) {
      return res.status(400).json({ error: 'sessionId, filename, and filePath are required' });
    }
    const project = await Project.findByIdAndUpdate(
      req.params.id,
      { $push: { sessions: { sessionId, filename, filePath } } },
      { returnDocument: 'after' }
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.status(201).json(project.sessions[project.sessions.length - 1]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:id/sessions', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project.sessions);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Multi-agent pattern endpoints ────────────────────────────────────────────

app.get('/api/multi-agent-patterns', async (req, res) => {
  try {
    const patterns = await MultiAgentPattern.find().sort({ name: 1 });
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


connect().then(() => {
  app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

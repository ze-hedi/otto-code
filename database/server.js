const express = require('express');
const cors = require('cors');
const { connect } = require('./connection');
const Agent = require('./models/Agent');
const AgentFile = require('./models/AgentFile');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/agents', async (req, res) => {
  const agents = await Agent.find().sort({ createdAt: 1 });
  res.json(agents);
});

app.post('/api/agents', async (req, res) => {
  try {
    const { 
      name, description, model, 
      thinkingLevel, sessionMode, workingDir, apiKey,
      systemPrompt, skills 
    } = req.body;

    const agent = await Agent.create({ 
      name, description, model,
      thinkingLevel, sessionMode, workingDir, apiKey 
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

app.get('/api/agents/:id/files', async (req, res) => {
  try {
    const files = await AgentFile.find({ agent_id: req.params.id });
    res.json(files);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    const { 
      name, description, model,
      thinkingLevel, sessionMode, workingDir, apiKey,
      systemPrompt, skills 
    } = req.body;

    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { name, description, model, thinkingLevel, sessionMode, workingDir, apiKey },
      { new: true, runValidators: true }
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

connect().then(() => {
  app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

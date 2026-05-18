const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ['agent', 'orchestrator'], default: 'agent' },
    description: { type: String, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Inactive' },
    thinkingLevel: { 
      type: String, 
      enum: ['off', 'low', 'medium', 'high', 'xhigh'], 
      default: 'medium' 
    },
    sessionMode: { 
      type: String, 
      enum: ['memory', 'disk', 'continue'], 
      default: 'memory' 
    },
    workingDir: {
      type: String,
      default: ''
    },
    playground: {
      type: String,
      default: ''
    },
    apiKey: {
      type: String,
      default: null
    },
    icon: {
      type: String,
      default: '🤖',
    },
    tools: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ToolSchema' }],
      default: [],
    },
    toolCallGuardrails: { type: Boolean, default: false },
    compaction: {
      enabled: { type: Boolean, default: true },
      reserveTokens: { type: Number, default: null },
      keepRecentTokens: { type: Number, default: null },
      customInstructions: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Agent', agentSchema);

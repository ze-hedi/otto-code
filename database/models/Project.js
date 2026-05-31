const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    repos: [
      {
        label: { type: String, required: true },
        path: { type: String, required: true },
        agents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
        orchestrators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
      },
    ],
    sessions: [
      {
        sessionId: { type: String, required: true },
        filename: { type: String, required: true },
        filePath: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);

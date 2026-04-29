# Otto Workflow Builder - React Version

This is a React conversion of the Otto Workflow Builder, a visual drag-and-drop interface for creating system architecture workflows.

## Features

- **Drag and Drop**: Drag components from the sidebar to the canvas
- **Visual Connections**: Connect nodes using bezier curves with drag handles
- **Component Categories**: Frontend, Backend, Data, and Infrastructure components
- **Export/Import**: Save and load workflow schemas as JSON
- **Undo Functionality**: Undo recent actions
- **Connection Mode**: Click nodes to create connections easily

## Getting Started

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
```

## Usage

1. **Add Components**: Drag components from the left sidebar onto the canvas
2. **Move Nodes**: Click and drag nodes to reposition them
3. **Create Connections**: 
   - Use "Connect" mode and click two nodes, or
   - Drag from the handles on the sides of nodes
4. **Delete Items**:
   - Hover over a node and click the × button
   - Click a connection and click the × button that appears
5. **Export/Import**: Save your workflow as JSON or load a previous workflow
6. **Undo**: Use the Undo button to revert recent actions

## Technology Stack

- React 18
- CSS3 (with custom styling)
- SVG for connection rendering
- Bootstrap Icons

## Project Structure

```
src/
  components/
    Canvas.jsx       - Main canvas with drop zone and SVG layer
    Header.jsx       - Top toolbar with action buttons
    Sidebar.jsx      - Component palette
    WorkflowNode.jsx - Individual node component
  constants.js       - Node types and metadata
  utils.js          - Helper functions for geometry and SVG
  WorkflowBuilder.jsx - Main component with state management
  WorkflowBuilder.css - Styles
  App.js            - Root component
  index.js          - Entry point
```

## Improvements over Original

- **Component-based architecture**: Easier to maintain and extend
- **React hooks**: Modern state management with useState, useCallback, useRef
- **Better separation of concerns**: Each component has a single responsibility
- **Reusable utilities**: Helper functions extracted for reuse
- **Props-based communication**: Clean data flow between components
- **Performance optimizations**: useCallback to prevent unnecessary re-renders

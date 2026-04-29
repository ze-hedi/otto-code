import React from 'react';
import { COMPONENT_CATEGORIES } from '../constants';

const Sidebar = ({ onDragStart }) => {
  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('text/plain', type);
    onDragStart(type);
  };

  return (
    <aside className="wf-sidebar">
      <div className="wf-sidebar-header">Components</div>
      <div className="wf-palette">
        {COMPONENT_CATEGORIES.map((category) => (
          <div key={category.title} className="wf-category">
            <div className="wf-category-title">{category.title}</div>
            {category.components.map((component) => (
              <div
                key={component.type}
                className="wf-component"
                draggable="true"
                data-type={component.type}
                onDragStart={(e) => handleDragStart(e, component.type)}
              >
                <div className="wf-component-icon">{component.icon}</div>
                <span>{component.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;

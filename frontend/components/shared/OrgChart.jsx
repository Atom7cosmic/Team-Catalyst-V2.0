'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

// Custom Node Component
function OrgChartNode({ data }) {
  const router = useRouter();

  return (
    <div className="bg-muted border border-slate-600 rounded-lg p-3 shadow-lg min-w-[180px]">
      <Handle type="target" position={Position.Top} className="bg-slate-400" />

      <div className="flex flex-col items-center gap-2">
        <Avatar className="h-12 w-12 border-2 border-slate-600">
          <AvatarImage src={data.avatar} alt={data.name} />
          <AvatarFallback className="bg-slate-700 text-slate-300">
            {data.name?.split(' ').map(n => n[0]).join('')}
          </AvatarFallback>
        </Avatar>

        <div className="text-center">
          <p
            className="font-medium text-slate-100 text-sm cursor-pointer hover:text-primary"
            onClick={() => router.push(`/team/${data.id}`)}
          >
            {data.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{data.role}</p>
        </div>

        <Badge variant="secondary" className="text-xs bg-slate-700 text-slate-300">
          Level {data.level}
        </Badge>
      </div>

      <Handle type="source" position={Position.Bottom} className="bg-slate-400" />
    </div>
  );
}

const nodeTypes = {
  orgNode: OrgChartNode
};

export default function OrgChart({ data, onNodeClick, className }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Transform data to ReactFlow format
  const transformData = useCallback((orgData) => {
    if (!orgData || orgData.length === 0) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    const levelHeight = 150;
    const nodeWidth = 200;

    // Group by level
    const levels = {};
    orgData.forEach(person => {
      if (!levels[person.level]) {
        levels[person.level] = [];
      }
      levels[person.level].push(person);
    });

    // Position nodes
    Object.entries(levels).forEach(([level, people]) => {
      const levelNum = parseInt(level);
      const y = levelNum * levelHeight;
      const totalWidth = people.length * nodeWidth;
      const startX = -(totalWidth / 2) + (nodeWidth / 2);

      people.forEach((person, index) => {
        nodes.push({
          id: person.id,
          type: 'orgNode',
          position: {
            x: startX + (index * nodeWidth),
            y: y
          },
          data: {
            id: person.id,
            name: person.name,
            role: person.role,
            level: person.level,
            avatar: person.avatar,
            parentId: person.parentId
          }
        });

        // Create edge to parent
        if (person.parentId) {
          edges.push({
            id: `edge-${person.parentId}-${person.id}`,
            source: person.parentId,
            target: person.id,
            type: 'smoothstep',
            style: { stroke: '#475569', strokeWidth: 2 },
            animated: false
          });
        }
      });
    });

    return { nodes, edges };
  }, []);

  // Initialize on mount
  useState(() => {
    if (data && !isInitialized) {
      const { nodes: newNodes, edges: newEdges } = transformData(data);
      setNodes(newNodes);
      setEdges(newEdges);
      setIsInitialized(true);
    }
  }, [data, isInitialized, transformData, setNodes, setEdges]);

  const handleNodeClick = useCallback((event, node) => {
    onNodeClick?.(node.data);
  }, [onNodeClick]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] bg-card rounded-lg border border-slate-700">
        <p className="text-muted-foreground">No organization data available</p>
      </div>
    );
  }

  return (
    <div className={className} style={{ height: 500 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.3}
        maxZoom={1.5}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#475569' }
        }}
      >
        <Background color="#334155" gap={16} />
        <Controls className="bg-muted border-slate-700 text-foreground" />
        <MiniMap
          nodeColor={(node) => {
            switch (node.data?.level) {
              case 1: return '#ef4444';
              case 2: return '#f97316';
              case 3: return '#eab308';
              default: return '#3b82f6';
            }
          }}
          maskColor="rgba(15, 23, 42, 0.8)"
          className="bg-card border-slate-700"
        />
      </ReactFlow>
    </div>
  );
}

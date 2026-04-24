'use client';

import { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@/lib/axios';
import toast from 'react-hot-toast';

const ROLE_COLORS = {
  'CEO': '#6366f1',
  'CTO': '#8b5cf6',
  'VP Engineering': '#a78bfa',
  'Director of Engineering': '#c4b5fd',
  'Engineering Manager': '#3b82f6',
  'Tech Lead': '#06b6d4',
  'Senior Engineer': '#10b981',
  'Software Engineer': '#34d399',
  'Junior Engineer': '#6ee7b7',
  'QA Engineer': '#f59e0b',
  'Intern': '#94a3b8',
};

// Given flat list, return the current user node + all descendants
function filterSubtree(flatData, currentUserId) {
  // Find the current user's node
  const currentNode = flatData.find(d => d.id === currentUserId);
  if (!currentNode) return flatData; // fallback: show all

  // Collect all descendant IDs using BFS
  const includedIds = new Set([currentUserId]);
  const queue = [currentUserId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    flatData.forEach(d => {
      if (d.parentId === parentId) {
        includedIds.add(d.id);
        queue.push(d.id);
      }
    });
  }

  // Return filtered nodes, making current user the root (no parent)
  return flatData
    .filter(d => includedIds.has(d.id))
    .map(d => d.id === currentUserId ? { ...d, parentId: null } : d);
}

export default function OrgChartPage() {
  const [orgData, setOrgData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const svgRef = useRef(null);

  useEffect(() => {
    fetchOrgChart();
  }, []);

  useEffect(() => {
    if (orgData) renderChart(orgData);
  }, [orgData]);

  const fetchOrgChart = async () => {
    try {
      const response = await api.get('/users/org-chart');
      const fullData = response.data.orgChart;

      // Get logged-in user from localStorage
      const storedUser = localStorage.getItem('user');
      const currentUser = storedUser ? JSON.parse(storedUser) : null;
      const currentUserId = currentUser?._id || currentUser?.id;

      // Filter to current user's subtree
      const filtered = currentUserId
        ? filterSubtree(fullData, currentUserId)
        : fullData;

      setOrgData(filtered);
    } catch (error) {
      console.error('Failed to fetch org chart:', error);
      toast.error('Failed to load org chart');
    } finally {
      setIsLoading(false);
    }
  };

  const renderChart = (flatData) => {
    const container = svgRef.current;
    if (!container) return;

    d3.select(container).selectAll('*').remove();

    const map = {};
    flatData.forEach(d => { map[d.id] = { ...d, children: [] }; });
    let root = null;
    flatData.forEach(d => {
      if (d.parentId && map[d.parentId]) {
        map[d.parentId].children.push(map[d.id]);
      } else {
        root = map[d.id];
      }
    });

    if (!root) return;

    const nodeWidth = 180;
    const nodeHeight = 80;

    const hierarchy = d3.hierarchy(root);
    const treeLayout = d3.tree().nodeSize([nodeWidth + 20, nodeHeight + 40]);
    treeLayout(hierarchy);

    let x0 = Infinity, x1 = -Infinity;
    hierarchy.each(d => {
      if (d.x < x0) x0 = d.x;
      if (d.x > x1) x1 = d.x;
    });

    const treeWidth = x1 - x0 + nodeWidth + 80;
    const treeHeight = (hierarchy.height + 1) * (nodeHeight + 40) + 60;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', treeWidth)
      .attr('height', treeHeight)
      .style('overflow', 'visible');

    const g = svg.append('g')
      .attr('transform', `translate(${treeWidth / 2 - (x0 + x1) / 2}, 20)`);

    // Links
    g.selectAll('.link')
      .data(hierarchy.links())
      .enter()
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .attr('d', d3.linkVertical().x(d => d.x).y(d => d.y));

    // Nodes
    const node = g.selectAll('.node')
      .data(hierarchy.descendants())
      .enter()
      .append('g')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    // Check if node is the logged-in user (root of subtree)
    const storedUser = localStorage.getItem('user');
    const currentUser = storedUser ? JSON.parse(storedUser) : null;
    const currentUserId = currentUser?._id || currentUser?.id;

    // Card background
    node.append('rect')
      .attr('x', -nodeWidth / 2)
      .attr('y', -nodeHeight / 2)
      .attr('width', nodeWidth)
      .attr('height', nodeHeight)
      .attr('rx', 10)
      .attr('fill', d => d.data.id === currentUserId ? '#1e3a5f' : '#1e293b')
      .attr('stroke', d => ROLE_COLORS[d.data.role] || '#475569')
      .attr('stroke-width', d => d.data.id === currentUserId ? 2.5 : 1.5);

    // Top accent bar
    node.append('rect')
      .attr('x', -nodeWidth / 2)
      .attr('y', -nodeHeight / 2)
      .attr('width', nodeWidth)
      .attr('height', 4)
      .attr('rx', 10)
      .attr('fill', d => ROLE_COLORS[d.data.role] || '#475569');

    // Avatar circle
    node.append('circle')
      .attr('cx', -nodeWidth / 2 + 28)
      .attr('cy', 0)
      .attr('r', 18)
      .attr('fill', d => (ROLE_COLORS[d.data.role] || '#475569') + '33')
      .attr('stroke', d => ROLE_COLORS[d.data.role] || '#475569')
      .attr('stroke-width', 1.5);

    // Initials
    node.append('text')
      .attr('x', -nodeWidth / 2 + 28)
      .attr('y', 5)
      .attr('text-anchor', 'middle')
      .attr('fill', d => ROLE_COLORS[d.data.role] || '#94a3b8')
      .attr('font-size', 11)
      .attr('font-weight', 'bold')
      .text(d => d.data.name.split(' ').map(n => n[0]).join('').slice(0, 2));

    // Name
    node.append('text')
      .attr('x', -nodeWidth / 2 + 54)
      .attr('y', -6)
      .attr('fill', '#f1f5f9')
      .attr('font-size', 12)
      .attr('font-weight', '600')
      .text(d => d.data.name.length > 14 ? d.data.name.slice(0, 14) + '…' : d.data.name);

    // Role
    node.append('text')
      .attr('x', -nodeWidth / 2 + 54)
      .attr('y', 10)
      .attr('fill', d => ROLE_COLORS[d.data.role] || '#94a3b8')
      .attr('font-size', 10)
      .text(d => d.data.role.length > 16 ? d.data.role.slice(0, 16) + '…' : d.data.role);

    // "You" badge on current user
    node.filter(d => d.data.id === currentUserId)
      .append('text')
      .attr('x', nodeWidth / 2 - 8)
      .attr('y', nodeHeight / 2 - 8)
      .attr('text-anchor', 'end')
      .attr('fill', '#6366f1')
      .attr('font-size', 9)
      .attr('font-weight', 'bold')
      .text('YOU');

    // Level badge
    node.append('text')
      .attr('x', nodeWidth / 2 - 10)
      .attr('y', -nodeHeight / 2 + 16)
      .attr('text-anchor', 'end')
      .attr('fill', '#64748b')
      .attr('font-size', 9)
      .text(d => `L${d.data.level}`);
  };

  return (
    <>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Org Chart</h1>
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle>Organization Structure</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-center py-12">Loading...</p>
            ) : (
              <div
                ref={svgRef}
                className="w-full overflow-auto"
                style={{ minHeight: '500px' }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
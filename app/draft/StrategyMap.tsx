'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

type Tool = 'select' | 'pen' | 'arrow' | 'ward' | 'control' | 'text' | 'eraser';
type DrawElement = 
  | { type: 'path'; points: [number,number][]; color: string; width: number; id: string }
  | { type: 'arrow'; from: [number,number]; to: [number,number]; color: string; width: number; id: string }
  | { type: 'ward'; pos: [number,number]; wardType: 'yellow'|'control'; id: string }
  | { type: 'text'; pos: [number,number]; content: string; color: string; id: string }
  | { type: 'player'; pos: [number,number]; side: 'blue'|'red'; role: string; id: string };

const ROLES = ['TOP','JNG','MID','BOT','SUP'];
const COLORS = ['#0596AA','#E84057','#C89B3C','#0ACF83','#F0E6D2','#9D48E0'];

interface Props {
  onSave?: (data: any) => void;
  initialData?: { elements: DrawElement[] } | null;
  userName?: string;
}

export default function StrategyMap({ onSave, initialData, userName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#0596AA');
  const [penWidth, setPenWidth] = useState(3);
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<[number,number][]>([]);
  const [arrowStart, setArrowStart] = useState<[number,number]|null>(null);
  const [draggingId, setDraggingId] = useState<string|null>(null);
  const [dragOffset, setDragOffset] = useState<[number,number]>([0,0]);
  const [textInput, setTextInput] = useState<{pos:[number,number],visible:boolean}>({pos:[0,0],visible:false});
  const [textValue, setTextValue] = useState('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapImgRef = useRef<HTMLImageElement|null>(null);
  const idCounter = useRef(0);
  const textInputRef = useRef<HTMLInputElement>(null);

  const genId = () => `el_${Date.now()}_${idCounter.current++}`;
  const initDone = useRef(false);

  // Load initial data
  useEffect(() => {
    if (initialData?.elements?.length) {
      setElements(initialData.elements);
      initDone.current = true;
    }
  }, [initialData]);

  // Load map image
  useEffect(() => {
    const img = new Image();
    img.onload = () => { mapImgRef.current = img; setMapLoaded(true); };
    img.src = '/rift.jpeg';
  }, []);

  // Init players if no data loaded and map is ready
  useEffect(() => {
    if (initDone.current || !mapLoaded) return;
    // Wait a tick for initialData to potentially arrive
    const timer = setTimeout(() => {
      if (initDone.current) return;
      initDone.current = true;
      const initPlayers: DrawElement[] = [];
      // Blue side - bottom left area
      const bluePositions: [number,number][] = [[0.18,0.55],[0.22,0.65],[0.35,0.50],[0.25,0.78],[0.28,0.82]];
      // Red side - top right area
      const redPositions: [number,number][] = [[0.82,0.45],[0.78,0.35],[0.65,0.50],[0.75,0.22],[0.72,0.18]];
      ROLES.forEach((role,i) => {
        initPlayers.push({ type:'player', pos:bluePositions[i], side:'blue', role, id:genId() });
        initPlayers.push({ type:'player', pos:redPositions[i], side:'red', role, id:genId() });
      });
      setElements(initPlayers);
    }, 200);
    return () => clearTimeout(timer);
  }, [mapLoaded]);

  // Canvas dimensions
  const getCanvasSize = useCallback(() => {
    if (!containerRef.current) return { w:800, h:800 };
    const rect = containerRef.current.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    return { w: size, h: size };
  }, []);

  // Render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapImgRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = getCanvasSize();
    canvas.width = w; canvas.height = h;

    // Draw map
    ctx.drawImage(mapImgRef.current, 0, 0, w, h);

    // Draw elements
    elements.forEach(el => {
      if (el.type === 'path') {
        if (el.points.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(el.points[0][0]*w, el.points[0][1]*h);
        for (let i=1; i<el.points.length; i++) ctx.lineTo(el.points[i][0]*w, el.points[i][1]*h);
        ctx.stroke();
      }
      else if (el.type === 'arrow') {
        const x1=el.from[0]*w, y1=el.from[1]*h, x2=el.to[0]*w, y2=el.to[1]*h;
        const angle = Math.atan2(y2-y1, x2-x1);
        const headLen = 14;
        ctx.beginPath();
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';
        ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.fillStyle = el.color;
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2-headLen*Math.cos(angle-Math.PI/6), y2-headLen*Math.sin(angle-Math.PI/6));
        ctx.lineTo(x2-headLen*Math.cos(angle+Math.PI/6), y2-headLen*Math.sin(angle+Math.PI/6));
        ctx.closePath(); ctx.fill();
      }
      else if (el.type === 'ward') {
        const x=el.pos[0]*w, y=el.pos[1]*h;
        const r = 8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fillStyle = el.wardType==='yellow' ? '#C89B3C' : '#E84057';
        ctx.fill();
        ctx.strokeStyle = '#010A13';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Eye icon
        ctx.fillStyle = '#010A13';
        ctx.font = 'bold 9px Barlow';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.wardType==='yellow'?'W':'C', x, y);
      }
      else if (el.type === 'text') {
        const x=el.pos[0]*w, y=el.pos[1]*h;
        ctx.font = 'bold 13px Barlow Condensed';
        ctx.fillStyle = '#010A13';
        ctx.strokeStyle = '#010A13';
        ctx.lineWidth = 3;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.strokeText(el.content, x+1, y+1);
        ctx.fillStyle = el.color;
        ctx.fillText(el.content, x, y);
      }
      else if (el.type === 'player') {
        const x=el.pos[0]*w, y=el.pos[1]*h;
        const r = 16;
        // Outer ring
        ctx.beginPath();
        ctx.arc(x, y, r+2, 0, Math.PI*2);
        ctx.fillStyle = el.side==='blue' ? 'rgba(5,150,170,0.3)' : 'rgba(232,64,87,0.3)';
        ctx.fill();
        // Circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fillStyle = el.side==='blue' ? '#0596AA' : '#E84057';
        ctx.fill();
        ctx.strokeStyle = el.side==='blue' ? '#0BE6FF' : '#FF6B7A';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Role text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Barlow Condensed';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.role, x, y);
      }
    });

    // Draw current path being drawn
    if (drawing && currentPath.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = penWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(currentPath[0][0]*w, currentPath[0][1]*h);
      for (let i=1; i<currentPath.length; i++) ctx.lineTo(currentPath[i][0]*w, currentPath[i][1]*h);
      ctx.stroke();
    }

    // Arrow preview
    if (arrowStart && drawing) {
      // will be drawn on mousemove
    }
  }, [elements, drawing, currentPath, arrowStart, color, penWidth, getCanvasSize, mapLoaded]);

  useEffect(() => { render(); }, [render]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // Mouse helpers
  const getPos = (e: React.MouseEvent): [number,number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0,0];
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX-rect.left)/rect.width, (e.clientY-rect.top)/rect.height];
  };

  const findElementAt = (pos: [number,number]): DrawElement|null => {
    const { w, h } = getCanvasSize();
    // Check players and wards first (point elements)
    for (let i=elements.length-1; i>=0; i--) {
      const el = elements[i];
      if (el.type === 'player') {
        const dx = (el.pos[0]-pos[0])*w, dy = (el.pos[1]-pos[1])*h;
        if (Math.sqrt(dx*dx+dy*dy) < 20) return el;
      }
      if (el.type === 'ward') {
        const dx = (el.pos[0]-pos[0])*w, dy = (el.pos[1]-pos[1])*h;
        if (Math.sqrt(dx*dx+dy*dy) < 12) return el;
      }
      if (el.type === 'text') {
        const dx = pos[0]-el.pos[0], dy = pos[1]-el.pos[1];
        if (dx >= 0 && dx < 0.15 && dy >= 0 && dy < 0.04) return el;
      }
    }
    // Then check paths and arrows (line elements — need proximity check)
    for (let i=elements.length-1; i>=0; i--) {
      const el = elements[i];
      if (el.type === 'path') {
        for (let j=0; j<el.points.length-1; j++) {
          if (pointToSegmentDist(pos, el.points[j], el.points[j+1], w, h) < 10) return el;
        }
      }
      if (el.type === 'arrow') {
        if (pointToSegmentDist(pos, el.from, el.to, w, h) < 10) return el;
      }
    }
    return null;
  };

  // Distance from point to line segment in pixel space
  const pointToSegmentDist = (p: [number,number], a: [number,number], b: [number,number], w: number, h: number): number => {
    const px=p[0]*w, py=p[1]*h, ax=a[0]*w, ay=a[1]*h, bx=b[0]*w, by=b[1]*h;
    const dx=bx-ax, dy=by-ay;
    const len2 = dx*dx+dy*dy;
    if (len2 === 0) return Math.sqrt((px-ax)**2+(py-ay)**2);
    let t = ((px-ax)*dx+(py-ay)*dy)/len2;
    t = Math.max(0, Math.min(1, t));
    const cx=ax+t*dx, cy=ay+t*dy;
    return Math.sqrt((px-cx)**2+(py-cy)**2);
  };

  // Mouse events
  const onMouseDown = (e: React.MouseEvent) => {
    // Only left click triggers tools — right click is handled by onContextMenu
    if (e.button !== 0) return;
    const pos = getPos(e);

    if (tool === 'select') {
      const el = findElementAt(pos);
      if (el && (el.type==='player'||el.type==='ward'||el.type==='text')) {
        setDraggingId(el.id);
        const elPos = el.type==='player'?el.pos:el.type==='ward'?el.pos:(el as any).pos;
        setDragOffset([pos[0]-elPos[0], pos[1]-elPos[1]]);
      }
      return;
    }

    if (tool === 'pen') {
      setDrawing(true);
      setCurrentPath([pos]);
      return;
    }

    if (tool === 'arrow') {
      if (!arrowStart) {
        setArrowStart(pos);
        setDrawing(true);
      }
      return;
    }

    if (tool === 'ward' || tool === 'control') {
      const newWard: DrawElement = { type:'ward', pos, wardType: tool==='ward'?'yellow':'control', id:genId() };
      setElements(prev => [...prev, newWard]);
      broadcastChange([...elements, newWard]);
      return;
    }

    if (tool === 'text') {
      setTextInput({ pos, visible: true });
      setTextValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }

    if (tool === 'eraser') {
      const el = findElementAt(pos);
      if (el) {
        const next = elements.filter(x => x.id !== el.id);
        setElements(next);
        broadcastChange(next);
      }
      return;
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const pos = getPos(e);

    if (draggingId) {
      setElements(prev => prev.map(el => {
        if (el.id !== draggingId) return el;
        if (el.type==='player') return {...el, pos:[pos[0]-dragOffset[0],pos[1]-dragOffset[1]] as [number,number]};
        if (el.type==='ward') return {...el, pos:[pos[0]-dragOffset[0],pos[1]-dragOffset[1]] as [number,number]};
        if (el.type==='text') return {...el, pos:[pos[0]-dragOffset[0],pos[1]-dragOffset[1]] as [number,number]};
        return el;
      }));
      return;
    }

    if (tool==='pen' && drawing) {
      setCurrentPath(prev => [...prev, pos]);
      return;
    }

    if (tool==='arrow' && drawing && arrowStart) {
      // Live preview - render with temp arrow
      const canvas = canvasRef.current;
      if (!canvas) return;
      render();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { w, h } = getCanvasSize();
      const x1=arrowStart[0]*w, y1=arrowStart[1]*h, x2=pos[0]*w, y2=pos[1]*h;
      const angle = Math.atan2(y2-y1, x2-x1);
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = penWidth;
      ctx.setLineDash([6,4]);
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2-14*Math.cos(angle-Math.PI/6), y2-14*Math.sin(angle-Math.PI/6));
      ctx.lineTo(x2-14*Math.cos(angle+Math.PI/6), y2-14*Math.sin(angle+Math.PI/6));
      ctx.closePath(); ctx.fill();
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const pos = getPos(e);

    if (draggingId) {
      setDraggingId(null);
      broadcastChange(elements);
      return;
    }

    if (tool==='pen' && drawing) {
      if (currentPath.length > 1) {
        const newPath: DrawElement = { type:'path', points:[...currentPath, pos], color, width:penWidth, id:genId() };
        const next = [...elements, newPath];
        setElements(next);
        broadcastChange(next);
      }
      setDrawing(false);
      setCurrentPath([]);
      return;
    }

    if (tool==='arrow' && drawing && arrowStart) {
      const dist = Math.sqrt(Math.pow(pos[0]-arrowStart[0],2)+Math.pow(pos[1]-arrowStart[1],2));
      if (dist > 0.02) {
        const newArrow: DrawElement = { type:'arrow', from:arrowStart, to:pos, color, width:penWidth, id:genId() };
        const next = [...elements, newArrow];
        setElements(next);
        broadcastChange(next);
      }
      setArrowStart(null);
      setDrawing(false);
      return;
    }
  };

  const addText = () => {
    if (!textValue.trim()) { setTextInput({pos:[0,0],visible:false}); return; }
    const newText: DrawElement = { type:'text', pos:textInput.pos, content:textValue.trim(), color, id:genId() };
    const next = [...elements, newText];
    setElements(next);
    broadcastChange(next);
    setTextInput({pos:[0,0],visible:false});
    setTextValue('');
  };

  const clearAll = () => {
    // Keep players, remove everything else
    const playersOnly = elements.filter(e => e.type === 'player');
    setElements(playersOnly);
    broadcastChange(playersOnly);
  };

  const clearDrawings = () => {
    const keep = elements.filter(e => e.type === 'player' || e.type === 'ward');
    setElements(keep);
    broadcastChange(keep);
  };

  const undo = () => {
    const last = [...elements];
    // Find last non-player element and remove it
    for (let i=last.length-1; i>=0; i--) {
      if (last[i].type !== 'player') {
        last.splice(i, 1);
        setElements(last);
        broadcastChange(last);
        return;
      }
    }
  };

  const broadcastChange = (data: DrawElement[]) => {
    if (onSave) onSave({ elements: data });
  };

  // Right click = eraser (always prevent context menu, delete element under cursor)
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    const el = findElementAt(pos);
    if (el && el.type !== 'player') {
      const next = elements.filter(x => x.id !== el.id);
      setElements(next);
      broadcastChange(next);
    }
  };

  const toolBtn = (t: Tool, label: string, icon: string) => (
    <button
      className={`stool ${tool===t?'active':''}`}
      onClick={() => setTool(t)}
      title={label}
    >
      <span className="stool-icon">{icon}</span>
      <span className="stool-label">{label}</span>
    </button>
  );

  return (
    <div className="smap-root">
      <style>{`
        .smap-root{display:flex;flex-direction:column;height:100%;overflow:hidden;background:#010A13;}

        .smap-toolbar{display:flex;align-items:center;gap:4px;padding:6px 10px;background:#091428;border-bottom:1px solid #1E2328;flex-shrink:0;flex-wrap:wrap;}
        .stool{display:flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid #1E2328;background:transparent;color:#5B5A56;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;transition:all 0.12s;}
        .stool:hover{color:#A09B8C;border-color:#5B5A56;}
        .stool.active{color:#C89B3C;border-color:#C89B3C;background:rgba(200,155,60,0.08);}
        .stool-icon{font-size:13px;}
        .stool-label{font-size:10px;}

        .smap-sep{width:1px;height:24px;background:#1E2328;margin:0 4px;flex-shrink:0;}

        .smap-colors{display:flex;gap:3px;align-items:center;}
        .smap-color{width:18px;height:18px;border-radius:3px;cursor:pointer;border:2px solid transparent;transition:all 0.12s;}
        .smap-color:hover{transform:scale(1.15);}
        .smap-color.on{border-color:#F0E6D2;box-shadow:0 0 6px rgba(240,230,210,0.3);}

        .smap-width{display:flex;align-items:center;gap:4px;}
        .smap-width label{font-size:9px;color:#5B5A56;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;}
        .smap-width input[type=range]{width:60px;accent-color:#C89B3C;height:3px;}

        .smap-actions{display:flex;gap:4px;margin-left:auto;}
        .smap-act{padding:5px 10px;border:1px solid #1E2328;background:transparent;color:#5B5A56;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;transition:all 0.12s;}
        .smap-act:hover{color:#F0E6D2;border-color:#5B5A56;}
        .smap-act.danger{color:#E84057;border-color:rgba(232,64,87,0.2);}
        .smap-act.danger:hover{border-color:#E84057;background:rgba(232,64,87,0.06);}

        .smap-canvas-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;padding:8px;}
        .smap-canvas{cursor:crosshair;border-radius:4px;box-shadow:0 0 30px rgba(0,0,0,0.5);}
        .smap-canvas.dragging{cursor:grabbing;}
        .smap-canvas.selecting{cursor:grab;}

        .smap-text-input{position:absolute;z-index:10;}
        .smap-text-input input{background:#091428;border:1px solid #C89B3C;color:#F0E6D2;padding:4px 8px;border-radius:3px;font-family:'Barlow Condensed';font-size:13px;font-weight:700;outline:none;min-width:120px;}

        .smap-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:9px;color:#3C3C41;letter-spacing:0.06em;pointer-events:none;}
      `}</style>

      {/* TOOLBAR */}
      <div className="smap-toolbar">
        {toolBtn('select','Seç','✋')}
        {toolBtn('pen','Kalem','✏️')}
        {toolBtn('arrow','Ok','➤')}
        {toolBtn('ward','Ward','💡')}
        {toolBtn('control','C.Ward','🔴')}
        {toolBtn('text','Metin','Aa')}
        {toolBtn('eraser','Sil','🗑')}

        <div className="smap-sep"/>

        <div className="smap-colors">
          {COLORS.map(c => (
            <div key={c} className={`smap-color ${color===c?'on':''}`}
              style={{background:c}} onClick={()=>setColor(c)}/>
          ))}
        </div>

        <div className="smap-sep"/>

        <div className="smap-width">
          <label>Kalınlık</label>
          <input type="range" min="1" max="8" value={penWidth}
            onChange={e=>setPenWidth(Number(e.target.value))}/>
        </div>

        <div className="smap-actions">
          <button className="smap-act" onClick={undo}>↩ Geri Al</button>
          <button className="smap-act" onClick={clearDrawings}>Çizimleri Sil</button>
          <button className="smap-act danger" onClick={clearAll}>Hepsini Sıfırla</button>
        </div>
      </div>

      {/* CANVAS */}
      <div className="smap-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={`smap-canvas ${draggingId?'dragging':''} ${tool==='select'?'selecting':''}`}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setDrawing(false); setCurrentPath([]); setDraggingId(null); }}
          onContextMenu={onContextMenu}
        />
        {textInput.visible && canvasRef.current && (
          <div className="smap-text-input" style={{
            left: canvasRef.current.getBoundingClientRect().left - containerRef.current!.getBoundingClientRect().left + textInput.pos[0]*canvasRef.current.width,
            top: canvasRef.current.getBoundingClientRect().top - containerRef.current!.getBoundingClientRect().top + textInput.pos[1]*canvasRef.current.height,
          }}>
            <input ref={textInputRef} value={textValue} onChange={e=>setTextValue(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter')addText(); if(e.key==='Escape')setTextInput({pos:[0,0],visible:false}); }}
              onBlur={addText}
              placeholder="Not yaz..."
            />
          </div>
        )}
        <div className="smap-hint">Sağ tık: element sil · Oyuncuları sürükle (Seç modu) · Ward'ları tıkla-koy</div>
      </div>
    </div>
  );
}

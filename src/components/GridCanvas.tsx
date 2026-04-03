/**
 * GridCanvas — HTML5 Canvas bird's-eye view of the 2D lake simulation grid.
 *
 * Rendering layers (bottom → top):
 *  1. Cell fill colour (water quality state)
 *  2. Grid lines (subtle)
 *  3. Inflow / outflow arrows
 *  4. Bloom border pulse
 *  5. Dead-zone overlay (darkening + X)
 *  6. Active intervention markers
 *  7. Hover highlight + cursor action preview
 *  8. Tooltip (HTML overlay, not canvas)
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CELL_LAND,
  CELL_INFLOW,
  CELL_OUTFLOW,
  BLOOM_THRESHOLD,
  SEVERE_BLOOM,
  ANOXIC_DO,
  HYPOXIC_DO,
  cellRGB,
  type CellState,
  type SimulationState,
  ACTION_META,
} from "../data/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL_SIZE  = 24;   // px per cell
const GRID_ROWS  = 20;
const GRID_COLS  = 28;
const CANVAS_W   = GRID_COLS * CELL_SIZE;   // 672
const CANVAS_H   = GRID_ROWS * CELL_SIZE;   // 480

// ─── Props ────────────────────────────────────────────────────────────────────

interface GridCanvasProps {
  state:           SimulationState | null;
  selectedAction:  number;    // currently selected action id
  onCellClick:     (row: number, col: number) => void;
  tickCount:       number;    // used to drive pulse animations
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GridCanvas: React.FC<GridCanvasProps> = ({
  state,
  selectedAction,
  onCellClick,
  tickCount,
}) => {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);

  // ── Draw helpers ─────────────────────────────────────────────────────────

  const drawGrid = useCallback(
    (ctx: CanvasRenderingContext2D, grid: CellState[][], tick: number) => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      const pulse = Math.sin(tick * 0.3) * 0.5 + 0.5; // 0→1 oscillation

      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          const cell = grid[r][c];
          const x    = c * CELL_SIZE;
          const y    = r * CELL_SIZE;

          // ── 1. Cell fill ──────────────────────────────────────────────────
          const [red, grn, blu] = cellRGB(cell);
          ctx.fillStyle = `rgb(${red},${grn},${blu})`;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);

          // ── 2. Grid line ──────────────────────────────────────────────────
          if (cell.cell_type !== CELL_LAND) {
            ctx.strokeStyle = "rgba(0,0,0,0.18)";
            ctx.lineWidth   = 0.5;
            ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
          }

          // ── 3. Inflow arrow ───────────────────────────────────────────────
          if (cell.cell_type === CELL_INFLOW) {
            drawInflowIndicator(ctx, x, y, r, c);
          }

          // ── 4. Outflow arrow ──────────────────────────────────────────────
          if (cell.cell_type === CELL_OUTFLOW) {
            ctx.fillStyle = "rgba(100,200,255,0.55)";
            ctx.beginPath();
            ctx.moveTo(x + CELL_SIZE / 2, y + CELL_SIZE - 3);
            ctx.lineTo(x + CELL_SIZE / 2 - 5, y + CELL_SIZE - 10);
            ctx.lineTo(x + CELL_SIZE / 2 + 5, y + CELL_SIZE - 10);
            ctx.closePath();
            ctx.fill();
          }

          // ── 5. Bloom border pulse ─────────────────────────────────────────
          if (cell.algae >= SEVERE_BLOOM) {
            const alpha = 0.55 + 0.45 * pulse;
            ctx.strokeStyle = `rgba(140,230,30,${alpha})`;
            ctx.lineWidth   = 2;
            ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            ctx.lineWidth   = 1;
          } else if (cell.algae >= BLOOM_THRESHOLD) {
            ctx.strokeStyle = `rgba(90,190,20,0.5)`;
            ctx.lineWidth   = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            ctx.lineWidth   = 1;
          }

          // ── 6. Dead zone overlay ──────────────────────────────────────────
          if (cell.cell_type !== CELL_LAND && cell.dissolved_oxygen <= ANOXIC_DO) {
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
            ctx.strokeStyle = "rgba(220,40,40,0.8)";
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + CELL_SIZE - 4, y + CELL_SIZE - 4);
            ctx.moveTo(x + CELL_SIZE - 4, y + 4); ctx.lineTo(x + 4, y + CELL_SIZE - 4);
            ctx.stroke();
            ctx.lineWidth = 1;
          } else if (cell.cell_type !== CELL_LAND && cell.dissolved_oxygen <= HYPOXIC_DO) {
            // Subtle hypoxia darkening
            ctx.fillStyle = `rgba(0,0,0,${0.20 + 0.10 * pulse})`;
            ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          }

          // ── 7. Active intervention dot ─────────────────────────────────────
          if (cell.active_interventions.length > 0) {
            const aid   = cell.active_interventions[0];
            const meta  = ACTION_META.find(a => a.id === aid);
            const color = meta?.color ?? "#ffffff";
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE - 5, y + 5, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          }
        }
      }
    },
    [],
  );

  const drawHover = useCallback(
    (ctx: CanvasRenderingContext2D, row: number, col: number, actionId: number) => {
      const x = col * CELL_SIZE;
      const y = row * CELL_SIZE;
      const meta = ACTION_META.find(a => a.id === actionId);
      const color = meta?.color ?? "#ffffff";
      const radius = meta?.radius ?? 0;

      // Highlight cells within radius
      if (radius > 0) {
        for (let r = Math.max(0, row - radius); r <= Math.min(GRID_ROWS - 1, row + radius); r++) {
          for (let c = Math.max(0, col - radius); c <= Math.min(GRID_COLS - 1, col + radius); c++) {
            if (Math.abs(r - row) + Math.abs(c - col) <= radius) {
              ctx.fillStyle = `${color}22`;
              ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
          }
        }
      }
      // Crosshair on target cell
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
      ctx.lineWidth = 1;
    },
    [],
  );

  // ── Main render effect ────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawGrid(ctx, state.grid, tickCount);
    if (hovered) {
      drawHover(ctx, hovered.row, hovered.col, selectedAction);
    }
  }, [state, tickCount, hovered, selectedAction, drawGrid, drawHover]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const getCellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const col  = Math.floor((e.clientX - rect.left)  / CELL_SIZE);
    const row  = Math.floor((e.clientY - rect.top)   / CELL_SIZE);
    return { row, col };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { row, col } = getCellFromEvent(e);
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      setHovered({ row, col });
    }
  };

  const handleMouseLeave = () => setHovered(null);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { row, col } = getCellFromEvent(e);
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      onCellClick(row, col);
    }
  };

  // ── Tooltip data ──────────────────────────────────────────────────────────

  const tooltipCell: CellState | null = useMemo(() => {
    if (!hovered || !state) return null;
    const { row, col } = hovered;
    if (row < 0 || row >= state.grid.length) return null;
    if (col < 0 || col >= state.grid[row].length) return null;
    return state.grid[row][col];
  }, [hovered, state]);

  const tooltipLeft = hovered ? hovered.col * CELL_SIZE + CELL_SIZE + 4 : 0;
  const tooltipTop  = hovered ? hovered.row * CELL_SIZE : 0;

  const cellTypeName = (t: number) =>
    t === 0 ? "Water" : t === 1 ? "Land" : t === 2 ? "Inflow" : "Outflow";

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative inline-block select-none">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="block rounded border border-[#1e3a5f] cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ imageRendering: "pixelated" }}
      />

      {/* Tooltip */}
      {tooltipCell && tooltipCell.cell_type !== CELL_LAND && (
        <div
          className="absolute z-10 pointer-events-none bg-[#0d1b2e]/95 border border-[#1e3a5f] rounded px-2 py-1.5 text-xs text-gray-300 min-w-[170px]"
          style={{
            left: tooltipLeft > CANVAS_W - 200 ? tooltipLeft - 200 : tooltipLeft,
            top:  tooltipTop  > CANVAS_H - 150 ? tooltipTop  - 140 : tooltipTop,
          }}
        >
          <div className="font-semibold text-white mb-1">
            ({hovered!.row}, {hovered!.col}) — {cellTypeName(tooltipCell.cell_type)}
          </div>
          <TooltipRow label="Algae"    value={tooltipCell.algae}            warn={tooltipCell.algae >= BLOOM_THRESHOLD} />
          <TooltipRow label="DO"       value={tooltipCell.dissolved_oxygen}  warn={tooltipCell.dissolved_oxygen <= HYPOXIC_DO} />
          <TooltipRow label="Nitrogen" value={tooltipCell.nitrogen} />
          <TooltipRow label="Phosph."  value={tooltipCell.phosphorus} />
          <TooltipRow label="Sediment" value={tooltipCell.sediment} />
          <TooltipRow label="Industrial" value={tooltipCell.industrial}     warn={tooltipCell.industrial > 30} />
          <TooltipRow label="Biodiver."  value={tooltipCell.biodiversity} />
        </div>
      )}

      {/* Corner scale legend */}
      <div className="absolute bottom-1 right-1 flex gap-2 text-[9px] text-gray-500 pointer-events-none">
        <span style={{ color: "#5cb85c" }}>■ Bloom</span>
        <span style={{ color: "#e05252" }}>■ Industrial</span>
        <span style={{ color: "#1a1a4a" }}>■ Dead zone</span>
        <span style={{ color: "#8b6914" }}>■ Sediment</span>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const TooltipRow: React.FC<{ label: string; value: number; warn?: boolean }> = ({
  label, value, warn,
}) => (
  <div className="flex justify-between gap-4">
    <span className="text-gray-400">{label}</span>
    <span className={warn ? "text-orange-400 font-semibold" : "text-gray-200"}>
      {value.toFixed(1)}
    </span>
  </div>
);

// ─── Inflow indicator drawing helper ─────────────────────────────────────────

function drawInflowIndicator(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  row: number, col: number,
): void {
  const cs = CELL_SIZE;
  const cx = x + cs / 2;
  const cy = y + cs / 2;

  // Direction of arrow: from edge inward
  let dx = 0, dy = 0;
  if (row === 0)          dy = 1;   // north edge → pointing down
  else if (col === 0)     dx = 1;   // west edge  → pointing right
  else if (col === GRID_COLS - 1) dx = -1; // east edge → pointing left

  const len = 7;
  ctx.strokeStyle = "rgba(80,170,255,0.75)";
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - dx * len, cy - dy * len);
  ctx.lineTo(cx + dx * len, cy + dy * len);
  ctx.stroke();
  // Arrowhead
  ctx.fillStyle = "rgba(80,170,255,0.75)";
  ctx.beginPath();
  ctx.moveTo(cx + dx * len, cy + dy * len);
  ctx.lineTo(cx + dx * len - dy * 4 - dx * 4, cy + dy * len + dx * 4 - dy * 4);
  ctx.lineTo(cx + dx * len + dy * 4 - dx * 4, cy + dy * len - dx * 4 - dy * 4);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
}

export default GridCanvas;

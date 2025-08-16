// src/components/DecisionTree.jsx
import React, { useMemo } from "react";

/**
 * Accepts a tree like:
 * {
 *   type: "decision", label: "Launch Timing", children: [
 *     { type: "chance", label: "Launch in Q1", children: [
 *        { type: "terminal", label: "High Sales", prob: 0.6, payoff: 90000 },
 *        { type: "terminal", label: "Low Sales",  prob: 0.4, payoff: 15000 }
 *     ]},
 *     { type: "chance", label: "Launch in Q3", children: [...] }
 *   ]
 * }
 *
 * Renders a simple HTML tree with EMV computed at each node.
 */

export default function DecisionTree({ tree }) {
  const annotated = useMemo(() => annotateEMV(tree), [tree]);
  return (
    <div style={wrap}>
      <TreeNode node={annotated} level={0} />
      <div style={{marginTop:8, fontSize:12, color:"#475569"}}>
        <b>Note:</b> EMV = Expected Monetary Value. For decision nodes, best child is highlighted.
      </div>
    </div>
  );
}

function annotateEMV(node) {
  if (!node || typeof node !== "object") return null;

  if (node.type === "terminal") {
    return { ...node, emv: Number(node.payoff || 0) };
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return { ...node, emv: 0 };
  }

  const children = node.children.map(annotateEMV);

  if (node.type === "chance") {
    // Sum(prob * EMV(child))
    let emv = 0;
    children.forEach(ch => {
      const p = Number(ch.prob ?? ch.p ?? 0);
      emv += p * Number(ch.emv || 0);
    });
    return { ...node, children, emv };
  }

  if (node.type === "decision") {
    // Choose max EMV child
    let best = children[0];
    children.forEach(ch => { if ((ch.emv || 0) > (best.emv || 0)) best = ch; });
    return { ...node, children, emv: best?.emv ?? 0, bestKey: children.indexOf(best) };
  }

  // Fallback
  return { ...node, children, emv: 0 };
}

function TreeNode({ node, level }) {
  if (!node) return null;
  const pad = { paddingLeft: level === 0 ? 0 : 18 };

  const head = (
    <div style={{display:"flex", gap:8, alignItems:"baseline", flexWrap:"wrap"}}>
      <span style={pill(node.type)}>{node.type}</span>
      {node.label && <span style={{fontWeight:600}}>{node.label}</span>}
      <span style={{marginLeft:"auto", fontSize:12, color:"#334155"}}>EMV: <b>{fmt(node.emv)}</b></span>
    </div>
  );

  if (!node.children || node.children.length === 0 || node.type === "terminal") {
    return (
      <div style={nodeBox}>
        {head}
        {node.type === "terminal" && (
          <div style={{fontSize:12, color:"#475569", marginTop:4}}>
            {node.payoff != null && <>Payoff: <b>{fmt(node.payoff)}</b></>}
            {node.prob != null && <> &nbsp;•&nbsp; Prob: <b>{node.prob}</b></>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{...nodeBox, ...pad}}>
      {head}
      <ul style={ul}>
        {node.children.map((ch, i) => (
          <li key={i} style={li(node.type === "decision" && node.bestKey === i)}>
            <TreeNode node={ch} level={level+1} />
            {ch.prob != null && ch.type !== "terminal" && (
              <div style={edgeNote}>p = {ch.prob}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* styles/helpers */

function fmt(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const wrap = { fontFamily:"system-ui, -apple-system, Segoe UI, Roboto", fontSize:14 };

const nodeBox = {
  background:"#fff",
  border:"1px solid #e6e8ee",
  borderRadius:10,
  padding:"10px 12px",
  margin:"8px 0"
};

const ul = {
  listStyle:"none",
  paddingLeft:14,
  margin: "6px 0 0"
};

const li = (highlight) => ({
  borderLeft: "2px solid " + (highlight ? "#1a73e8" : "#e6e8ee"),
  paddingLeft: 10,
  margin: "8px 0",
});

const edgeNote = {
  fontSize: 12,
  color: "#475569",
  marginTop: 4,
};

const pill = (type) => ({
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #dbe9ff",
  background: type === "decision" ? "#eef5ff" : type === "chance" ? "#f6ffed" : "#fff7ed",
  color: type === "decision" ? "#1a73e8" : type === "chance" ? "#0a7" : "#b45f06",
});

package metamodel

import (
	json2 "encoding/json"
	"io"

	"github.com/pflow-xyz/pflow-app/metamodel/token"
)

type importModel struct {
	ModelType   string                `json:"modelType"`
	Places      map[string]PlaceInt64 `json:"places"`
	Transitions map[string]Transition `json:"transitions"`
	Arrows      []ArrowInt64          `json:"arcs"`
}

type PlaceInt64 struct {
	Offset   int   `json:"offset"`
	Initial  int64 `json:"initial,omitempty"`  // Initial Token
	Capacity int64 `json:"capacity,omitempty"` // Capacity Token
	X        int   `json:"x"`
	Y        int   `json:"y"`
}

type ArrowInt64 struct {
	Source  string `json:"source"`
	Target  string `json:"target"`
	Weight  int64  `json:"weight,omitempty"`
	Inhibit bool   `json:"inhibit,omitempty"`
}

func (m *importModel) ToModel() *Model {
	model := NewModel()
	model.ModelType = m.ModelType
	model.Places = make(map[string]Place)
	for label, place := range m.Places {
		model.Places[label] = Place{
			Offset:   place.Offset,
			Initial:  token.Token{[]int64{place.Initial}},
			Capacity: token.Token{[]int64{place.Capacity}},
			X:        place.X,
			Y:        place.Y,
		}
	}

	model.Transitions = make(map[string]Transition)
	for label, transition := range m.Transitions {
		model.Transitions[label] = Transition{
			X: transition.X,
			Y: transition.Y,
		}
	}

	model.Arrows = make([]Arrow, len(m.Arrows))
	for i, arrow := range m.Arrows {
		model.Arrows[i] = Arrow{
			Source:  arrow.Source,
			Target:  arrow.Target,
			Weight:  token.Token{[]int64{arrow.Weight}},
			Inhibit: arrow.Inhibit,
		}
	}

	return model
}

func (m *Model) FromJson(jsonStr string) (*Model, error) {
	var raw map[string]json2.RawMessage
	if err := json2.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return nil, err
	}

	// optional metadata
	if v, ok := raw["@type"]; ok {
		var s string
		_ = json2.Unmarshal(v, &s)
		m.ModelType = s
	}

	// places
	m.Places = make(map[string]Place)
	if v, ok := raw["places"]; ok {
		var places map[string]map[string]json2.RawMessage
		if err := json2.Unmarshal(v, &places); err == nil {
			for label, p := range places {
				var offset, x, y int
				var initialArr, capacityArr []int64
				if bv, ok := p["offset"]; ok {
					_ = json2.Unmarshal(bv, &offset)
				}
				if bv, ok := p["x"]; ok {
					_ = json2.Unmarshal(bv, &x)
				}
				if bv, ok := p["y"]; ok {
					_ = json2.Unmarshal(bv, &y)
				}
				if bv, ok := p["initial"]; ok {
					_ = json2.Unmarshal(bv, &initialArr)
				}
				if bv, ok := p["capacity"]; ok {
					_ = json2.Unmarshal(bv, &capacityArr)
				}
				var init token.Token
				if len(initialArr) > 0 {
					init = token.Token{initialArr}
				} else {
					init = token.Token{[]int64{0}}
				}
				var cap token.Token
				if len(capacityArr) > 0 {
					cap = token.Token{capacityArr}
				} else {
					cap = token.Token{[]int64{0}}
				}
				m.Places[label] = Place{
					Offset:   offset,
					Initial:  init,
					Capacity: cap,
					X:        x,
					Y:        y,
				}
			}
		}
	}

	// transitions
	m.Transitions = make(map[string]Transition)
	if v, ok := raw["transitions"]; ok {
		var transitions map[string]map[string]json2.RawMessage
		if err := json2.Unmarshal(v, &transitions); err == nil {
			for label, t := range transitions {
				var x, y int
				if bv, ok := t["x"]; ok {
					_ = json2.Unmarshal(bv, &x)
				}
				if bv, ok := t["y"]; ok {
					_ = json2.Unmarshal(bv, &y)
				}
				m.Transitions[label] = Transition{X: x, Y: y}
			}
		}
	}

	// arcs
	m.Arrows = make([]Arrow, 0)
	if v, ok := raw["arcs"]; ok {
		var arcs []map[string]json2.RawMessage
		if err := json2.Unmarshal(v, &arcs); err == nil {
			for _, a := range arcs {
				var src, tgt string
				var weightArr []int64
				var inhibit bool
				if bv, ok := a["source"]; ok {
					_ = json2.Unmarshal(bv, &src)
				}
				if bv, ok := a["target"]; ok {
					_ = json2.Unmarshal(bv, &tgt)
				}
				if bv, ok := a["weight"]; ok {
					_ = json2.Unmarshal(bv, &weightArr)
				}
				if bv, ok := a["inhibitTransition"]; ok {
					_ = json2.Unmarshal(bv, &inhibit)
				}
				var w token.Token
				if len(weightArr) > 0 {
					w = token.Token{weightArr}
				} else {
					w = token.Token{[]int64{0}}
				}
				m.Arrows = append(m.Arrows, Arrow{
					Source:  src,
					Target:  tgt,
					Weight:  w,
					Inhibit: inhibit,
				})
			}
		}
	}

	return m, nil
}

func (m *Model) ToJson(w io.Writer) {
	out := map[string]interface{}{
		"@context": "https://pflow.xyz/schema",
		"@type":    "PetriNet",
		"token":    []string{"https://pflow.xyz/tokens/black"},
	}

	places := make(map[string]map[string]interface{}, len(m.Places))
	for label, p := range m.Places {
		pp := map[string]interface{}{
			"@type":  "Place",
			"offset": p.Offset,
			"x":      p.X,
			"y":      p.Y,
		}
		if len(p.Initial.Value) > 0 && p.Initial.Value[0] != 0 {
			pp["initial"] = []int64{p.Initial.Value[0]}
		}
		if len(p.Capacity.Value) > 0 && p.Capacity.Value[0] != 0 {
			pp["capacity"] = []int64{p.Capacity.Value[0]}
		}
		places[label] = pp
	}
	out["places"] = places

	transitions := make(map[string]map[string]interface{}, len(m.Transitions))
	for label, t := range m.Transitions {
		transitions[label] = map[string]interface{}{
			"@type": "Transition",
			"x":     t.X,
			"y":     t.Y,
		}
	}
	out["transitions"] = transitions

	arcs := make([]map[string]interface{}, 0, len(m.Arrows))
	for _, a := range m.Arrows {
		arc := map[string]interface{}{
			"@type":  "Arrow",
			"source": a.Source,
			"target": a.Target,
		}
		if len(a.Weight.Value) > 0 && a.Weight.Value[0] != 0 {
			arc["weight"] = []int64{a.Weight.Value[0]}
		}
		if a.Inhibit {
			arc["inhibitTransition"] = true
		}
		arcs = append(arcs, arc)
	}
	out["arcs"] = arcs

	enc := json2.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
}

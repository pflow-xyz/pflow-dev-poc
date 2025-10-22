package cid

import (
	json "github.com/gibson042/canonicaljson-go"
	cid2 "github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"github.com/multiformats/go-multihash"
)

var encoder, _ = multibase.EncoderByName("base58btc")

type Cid struct {
	*cid2.Cid
}

func (c Cid) String() string {
	return c.Encode(encoder)
}

func toCid(data []byte) (*Cid, error) {
	newId, err := cid2.Prefix{
		Version:  1,
		Codec:    0x0129, // dag-json (use JSON-LD / DAG-JSON codec)
		MhType:   multihash.SHA2_256,
		MhLength: -1, // default length
	}.Sum(data)

	return &Cid{&newId}, err
}

func ToCid(b ...[]byte) *Cid {
	data := []byte{}
	for _, v := range b {
		data = append(data, v...)
	}
	newCid, err := toCid(data)
	if err != nil {
		panic(err)
	}
	return newCid
}

func NewCid(i interface{}) *Cid {
	if c, ok := i.(*Cid); ok {
		return c
	}
	if c, ok := i.([]byte); ok {
		return ToCid(c)
	}
	return ToCid(Marshal(i))
}

func Marshal(i interface{}) []byte {
	data, err := json.Marshal(i)
	if err != nil {
		panic(err)
	}
	return data
}

func Unmarshal(data []byte, any interface{}) error {
	return json.Unmarshal(data, any)
}

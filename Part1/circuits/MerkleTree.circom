pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    var leaf_node_count = 2**n / 2;
    var branch_node_count = leaf_node_count - 1;

    component hash[leaf_node_count + branch_node_count];

    for(var i = 0; i < leaf_node_count + branch_node_count; i++)
    {
        hash[i] = Poseidon(2);
    }

    for(var i = 0; i < leaf_node_count; i++)
    {
        hash[i].inputs[0] <== leaves[i*2];
        hash[i].inputs[1] <== leaves[i*2 + 1];
    }

    for(var i = 0; i < branch_node_count; i++)
    {
        hash[leaf_node_count + i].inputs[0] <== hash[i*2].out;
        hash[leaf_node_count + i].inputs[1] <== hash[i*2 + 1].out;
    }

    root <== hash[leaf_node_count + branch_node_count - 1].out;
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    var latest_hash = leaf;

    component hash[n];
    component mux[n];

    for(var i = 0; i < n; i++)
    {
        hash[i] = Poseidon(2);
        mux[i] = MultiMux1(2);

        mux[i].c[0][0] <== path_elements[i];
        mux[i].c[0][1] <== latest_hash;

        mux[i].c[1][0] <== latest_hash;
        mux[i].c[1][1] <== path_elements[i];

        mux[i].s <== path_index[i];

        hash[i].inputs[0] <== mux[i].out[0];
        hash[i].inputs[1] <== mux[i].out[1];

        latest_hash = hash[i].out;
    }
    root <== latest_hash;
}
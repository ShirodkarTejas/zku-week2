//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        hashes = [0, 0, 0, 0, 0, 0, 0, 0];

        for(uint32 i = 0; i < 7; i++) {
            hashes.push(PoseidonT3.poseidon([hashes[2*i], hashes[2*i + 1]]));
        }
        root = hashes[14];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        require(index < 8, "Error: Tree is already full");
        hashes[index] = hashedLeaf;

        uint currentIndex = index;
        for(uint32 i = 0; i < 3; ++i)
        {
            uint256 hash = 0;
            if(index % 2 == 0)
            {
                hash = PoseidonT3.poseidon([hashes[currentIndex], hashes[currentIndex + 1]]);
            }
            else
            {
                hash = PoseidonT3.poseidon([hashes[currentIndex - 1], hashes[currentIndex]]);
            }

            currentIndex = 8 + (currentIndex / 2);
            hashes[currentIndex] = hash;
        }
        
        index++;
        root = hashes[14];
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return verifyProof(a, b, c, input);
    }
}

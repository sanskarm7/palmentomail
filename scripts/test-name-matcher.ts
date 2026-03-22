import { findCanonicalName } from "../src/lib/name-matcher";

const canonicalNames = ["Justin Siek", "Leo Song Wu-Hacohen", "Juan Muhirwe", "Sanskar Mishra", "Matthew Traynham"];

console.log("Input: LEO WU-HACOHEN -> Output: " + findCanonicalName("LEO WU-HACOHEN", canonicalNames));
console.log("Input: Justin S -> Output: " + findCanonicalName("Justin S", canonicalNames));
console.log("Input: Juan -> Output: " + findCanonicalName("Juan", canonicalNames));

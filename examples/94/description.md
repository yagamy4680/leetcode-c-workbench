# 94. Binary Tree Inorder Traversal

**Easy** · [Original problem](https://leetcode.com/problems/binary-tree-inorder-traversal/description/)

Produce an array containing the values encountered during an inorder traversal
of the supplied binary tree: traverse the left subtree, append the current
node's value, then traverse the right subtree.

## Examples

### Example 1

`root = [1,null,2,3]` produces `[1,3,2]`.

![Example 1: a binary tree with root 1, right child 2, and node 3 as the left child of 2.](https://assets.leetcode.com/uploads/2024/08/29/screenshot-2024-08-29-202743.png)

### Example 2

`root = [1,2,3,4,5,null,8,null,null,6,7,9]` produces `[4,2,6,5,7,1,3,9,8]`.

![Example 2: the larger binary tree used to illustrate inorder traversal.](https://assets.leetcode.com/uploads/2024/08/29/tree_2.png)

### Example 3

`root = []` produces `[]`.

### Example 4

`root = [1]` produces `[1]`.

The tree contains at most 100 nodes, including the possibility of no nodes.
Values range from -100 through 100. The follow-up asks for an iterative approach.

## Local C contract

```c
int* inorderTraversal(struct TreeNode* root, int* returnSize);
```

The driver converts the `root` JSON field from LeetCode's level-order format,
where `null` represents a missing child. `struct TreeNode` has `val`, `left`,
and `right` fields. The driver owns all input nodes; do not free them.
Return a newly allocated integer array and set `*returnSize` to its length.
For an empty tree, returning `NULL` with a length of zero is valid.
The driver frees the output array and input tree after serializing the answer.

The starter is intentionally incomplete. Tests include the official examples,
negative values, duplicate values, skewed trees, and a 100-node boundary case.
Exact comparison preserves traversal order; sorting the values is incorrect.

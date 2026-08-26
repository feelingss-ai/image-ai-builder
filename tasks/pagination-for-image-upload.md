# Test: try to import 6000+ dog pose images

Created: 2026-08-21

## Problem

- The UI tries to show each image one by one on the page
- DOM operations get slow down over time as more images are rendered
- Need to design pagination for the image upload page

## Goal

- Support importing 6000+ images without performance degradation
- Images should load and display efficiently without slowing down the DOM

## Approach

- Add pagination to the image upload/preview page
- Only render visible images (lazy load or virtual scroll)
- Benchmark with 6000+ dog pose images

## Test Data

- 6000+ dog pose images for stress testing

## Status

- [ ] Design pagination UI
- [ ] Implement lazy loading or virtual scroll
- [ ] Test with 6000+ images
- [ ] Benchmark DOM performance before and after

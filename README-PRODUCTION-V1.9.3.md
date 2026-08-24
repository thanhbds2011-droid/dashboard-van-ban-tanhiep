# Production V1.9.3

## Luồng bắt buộc

1. Ban Giám đốc giao nhiệm vụ cho Phòng/Khu.
2. Trưởng/Phó Phòng/Khu xác nhận Phòng/Khu đã tiếp nhận.
3. Trưởng/Phó Phòng/Khu phân công nội bộ cho chính mình hoặc nhân viên cùng Phòng/Khu.
4. Người được phân công xác nhận cá nhân đã nhận.
5. Nhiệm vụ chuyển sang Đang xử lý.

## Tương thích dữ liệu cũ

Nhiệm vụ BGĐ cũ có `ownerUserId = ""`, `status/assignmentStatus = CHO_PHAN_CONG` và thiếu `departmentAssignmentStatus` sẽ được nhận diện là chưa tiếp nhận. Trưởng/Phó phòng phải bấm **Xác nhận Phòng/Khu đã nhận** trước khi phân công.

## Build

- App: V1.9.3
- Build: `20260805.V1_9_3`
